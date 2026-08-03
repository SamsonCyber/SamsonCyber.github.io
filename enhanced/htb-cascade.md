#Windows #ActiveDirectory #RPC #LDAP #VNC #WinRM #SQLite #dnSpy #ADRecycleBin #Base64

## Overview

Cascade is a medium Windows Active Directory box and one of the better "credentials lead to more credentials" chains on HTB. There's no exploit anywhere, every step is enumeration and credential recovery: an LDAP-stored legacy password, an encrypted VNC password with a hardcoded key, a .NET binary reverse-engineered in dnSpy to recover a database password, and finally the **AD Recycle Bin**, where a deleted admin account still carries the password that owns the domain.

> **Screenshot would help here:** the `CascAudit.exe` step is done in **dnSpy**, setting a breakpoint and reading a decrypted value at runtime. A screenshot of dnSpy paused on that line would make the reverse-engineering step far clearer than prose.

## Recon

Anonymous SMB connected but listed no shares. When SMB null sessions come up empty, the next stop is RPC, which was open:

```sh
rpcclient -U '' -N 10.10.10.182
rpcclient $> enumdomusers
user:[arksvc] user:[s.smith] user:[r.thompson] user:[BackupSvc] ...
```

> **Why RPC after SMB:** even with no readable shares, `rpcclient` can often enumerate domain users over the same null session. That user list becomes the spray/target set for everything downstream.

LDAP was also queryable anonymously. Dumping person objects surfaced a non-standard attribute on `r.thompson`:

```sh
ldapsearch -h 10.10.10.182 -x -b "DC=cascade,DC=local" '(objectClass=person)'
cascadeLegacyPwd: clk0bjVldmE=
```

> **`cascadeLegacyPwd`** is a custom attribute the admins added to store a password, base64-encoded, which is encoding, not encryption. Decoding it is instant:

```sh
echo clk0bjVldmE= | base64 -d   ->   ‹redacted›
```

## Foothold

### r.thompson → VNC Password → s.smith

Those creds failed over WinRM but worked for SMB. The `data` share held `VNC Install.reg` containing an encrypted VNC password:

```
"Password"=hex:6b,cf,2a,4b,6e,5a,ca,0f
```

> **Why VNC passwords are trivially reversible:** VNC encrypts the stored password with a *fixed, publicly known* DES key. Tools like `vncpwd` just decrypt it. It's obfuscation, not security.

```sh
echo '6bcf2a4b6e5aca0f' | xxd -r -p > vnc_enc_pass
/opt/vncpwd/vncpwd vnc_enc_pass   ->   Password: ‹redacted›
```

That password belonged to **s.smith**, and this one *did* work over WinRM:

```sh
crackmapexec winrm 10.10.10.182 -u s.smith -p ‹redacted›   ->   (Pwn3d!)
evil-winrm -u s.smith -p ‹redacted› -i 10.10.10.182
```

## Privilege Escalation

### s.smith → dnSpy → arksvc

`s.smith` belonged to the "Audit Share" group, granting access to the `Audit$` share. It contained `Audit.db` (SQLite), `CascAudit.exe`, and `RunAudit.bat`:

```
CascAudit.exe "\\CASC-DC1\Audit$\DB\Audit.db"
```

The SQLite data was base64 that wouldn't decode, encrypted. So I loaded `CascAudit.exe` into **dnSpy**. The binary opens the DB, reads the `Ldap` table, and decrypts a password in code. Setting a breakpoint where the SQL connection closes and running it with a copy of `Audit.db` revealed the plaintext:

```
arksvc : ‹redacted›
```

```sh
crackmapexec winrm 10.10.10.182 -u arksvc -p ‹redacted›   ->   (Pwn3d!)
```

### arksvc → AD Recycle Bin → Administrator

`arksvc` is a member of **AD Recycle Bin**.

> **Why that group is the win:** when an AD object is deleted, it isn't immediately purged, it's tombstoned in the Recycle Bin, *retaining its attributes*. Members of the AD Recycle Bin group can read deleted objects. If a now-deleted account had a password stored in `cascadeLegacyPwd`, it's still there.

Querying deleted objects turned up a `TempAdmin` account (referenced earlier in an HTML file) with the legacy attribute set:

```powershell
Get-ADObject -filter { SAMAccountName -eq "TempAdmin" } -includeDeletedObjects -property *
cascadeLegacyPwd : YmFDVDNyMWFOMDBkbGVz
```

```sh
echo YmFDVDNyMWFOMDBkbGVz | base64 -d   ->   ‹redacted›
```

`TempAdmin`'s password was reused by the real **Administrator**:

```sh
crackmapexec winrm 10.10.10.182 -u administrator -p ‹redacted›   ->   (Pwn3d!)
```

## Root

```sh
evil-winrm -u administrator -p ‹redacted› -i 10.10.10.182
```

Box rooted.

## Takeaways

- **When SMB null gives no shares, pivot to RPC and LDAP.** Both leaked the user list and the first password here.
- **VNC stored passwords use a fixed key**, recoverable instantly with `vncpwd`.
- **Reverse the binary when the data is encrypted.** dnSpy turned an opaque SQLite blob into a working credential.
- **AD Recycle Bin retains attributes of deleted objects**, including legacy passwords, and admins reuse them. That chain of reuse is what ultimately owned the domain.
