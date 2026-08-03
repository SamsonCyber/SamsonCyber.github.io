#Linux #FTP #DefaultCreds #PCAP #ExifTool #CVE #RCE #FileUpload

## Overview

ExGhost is a Linux box with two open ports: FTP and HTTP. HTTP returns 403 everywhere except `/uploads`, which is also forbidden. The attack path starts on FTP, where default credentials grant access to a PCAP capture file. Analyzing the PCAP in Wireshark reveals HTTP traffic to `/exiftest.php` running ExifTool 12.23, a version vulnerable to CVE-2021-22204, which allows arbitrary code execution via a malicious image file. The PCAP also contains enough HTML to reconstruct the upload form, enabling the exploit to be triggered remotely.

> **Note:** these notes are incomplete, they document the recon, PCAP analysis, and ExifTool CVE identification, and show the reconstructed upload form. The actual exploit delivery and post-foothold steps are not documented. Written as in-progress.

## Recon

### Nmap

```sh
PORT   STATE SERVICE VERSION
21/tcp open  ftp     vsftpd 3.0.3
80/tcp open  http    Apache httpd 2.4.41 (Ubuntu)  [403 Forbidden]
```

### HTTP Enumeration

Gobuster finds only `/uploads`, which also returns 403:

```sh
gobuster dir -u http://192.168.158.183/ -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
/uploads  (Status: 301) [--> http://192.168.158.183/uploads/]
```

Every path on port 80 is blocked. The attack surface shifts to FTP.

## Foothold

### FTP Default Credentials

Hydra brute-forces FTP with a default credentials list:

```sh
hydra -C /usr/share/wordlists/SecLists/Passwords/Default-Credentials/ftp-betterdefaultpasslist.txt ftp://192.168.158.183 -V
[21][ftp] host: 192.168.158.183   login: user   password: system
```

Logging in with `user:system` reveals a single file:

```sh
ftp user@192.168.158.183
ftp> passive
Passive mode: off; fallback to active mode: off.
ftp> dir
-rwxrwxrwx    1 0    0    126151 Jan 27  2022 backup
ftp> get backup
226 Transfer complete.
```

> **Why "backup" is the interesting file:** it's the only file on the server, it's world-writable, and its name suggests it was placed there deliberately. The unusual permissions (777) on an FTP file are a strong hint that it contains something meant to be found.

### PCAP Analysis

The downloaded file is a network capture:

```sh
file backup
backup: pcap capture file, microsecond ts (little-endian) - version 2.4 (Ethernet, capture length 262144)
```

Opening in Wireshark shows several HTTP POST requests to `/exiftest.php`. The response body in the "Line-based text data" layer reveals the ExifTool version:

```
ExifTool Version Number: 12.23
```

ExifTool 12.23 is vulnerable to **CVE-2021-22204, Arbitrary Code Execution**:

```
ExifTool < 12.24 - Arbitrary Code Execution via DjVu file parsing
https://www.exploit-db.com/exploits/50911
```

> **How CVE-2021-22204 works:** ExifTool parses DjVu files and evaluates certain metadata fields through Perl's `eval`. A crafted DjVu file (disguised as a JPEG) with a malicious metadata payload causes ExifTool to execute arbitrary system commands when it processes the file. Any application that calls ExifTool on uploaded images without sandboxing is exploitable by anyone who can upload a file.

### Reconstructing the Upload Form

Direct navigation to `/exiftest.php` is blocked by Apache. The PCAP contains the full HTTP request including form structure, allowing the page to be reconstructed locally:

```html
<form method="post" action="http://192.168.158.183/exiftest.php" enctype="multipart/form-data">
    <input type="file" name="myFile" />
    <input type="file" name="myFile" />
</form>
```

The form targets the real server's `/exiftest.php`, so submitting a malicious file from a local HTML page delivers the exploit to the target.

## Takeaways

- **FTP default credentials are a reliable first check.** Hydra against a short default list costs seconds and often pays off on less-hardened targets.
- **PCAP files are goldmines.** A single capture file revealed the internal web path, the running application, and its exact version, information that would otherwise require authenticated access to the site.
- **ExifTool CVE-2021-22204 is triggered by file processing, not direct access.** Even with port 80 fully blocked, any pipeline that runs ExifTool on uploaded files is reachable via the upload mechanism the PCAP revealed.
