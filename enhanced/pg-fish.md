#Windows #GlassFish #DirectoryTraversal #SynaMan #CredentialExposure #InfoDisclosure

## Overview

Fish is a Windows machine running two services: Sun GlassFish 4.1 and SynaMan 5.1. GlassFish is vulnerable to directory traversal, which serves as the recon vehicle. SynaMan stores SMTP credentials in a world-readable XML config file, leaking plaintext credentials for user `arthur`.

> **Note:** these notes are incomplete, coverage ends at credential discovery from the SynaMan config file. The foothold (shell as `arthur` or further) and privilege escalation are not documented.

## Recon

### Nmap

```sh
PORT     STATE SERVICE
4848/tcp open  appserv-http   (GlassFish admin console)
7676/tcp open  imqbrokerd
8080/tcp open  http-proxy
8181/tcp open  intermapper
3389/tcp open  ms-wbt-server
135/tcp  open  msrpc
139/tcp  open  netbios-ssn
445/tcp  open  microsoft-ds
```

Banner grabbing on port 8080 identifies:

```
Sun GlassFish Open Source Edition 4.1
```

## Enumeration

### GlassFish Directory Traversal

GlassFish 4.1 is vulnerable to directory traversal (EDB-39441). The PoC successfully retrieves `win.ini`, confirming the vulnerability. Two GlassFish credential files are worth targeting according to the official Oracle docs:

```
glassfish4/glassfish/domains/domain1/config/admin-keyfile
glassfish4/glassfish/domains/domain1/config/local-password
```

Both files are retrieved via traversal, but cracking attempts against their contents produce no results.

> **Why GlassFish stores creds in `admin-keyfile`:** GlassFish uses a file-based admin authentication system. The `admin-keyfile` holds the admin password in a hashed form, and `local-password` is a randomly generated token for local admin access. Even with traversal, these hashes are strong enough to resist offline cracking in this case, the traversal is useful for reading other config files rather than directly cracking GlassFish auth.

### SynaMan Config, Plaintext Credentials

The port scanner initially missed port 6060, where SynaMan 5.1 is running. SynaMan is a file-transfer application; its configuration is stored in an XML file. The traversal on GlassFish reaches it:

```sh
/synaman/config/AppConfig.xml
```

Contents (relevant excerpt):

```xml
<parameter name="smtpUser" type="1" value="arthur"></parameter>
<parameter name="smtpPassword" type="1" value="KingOfAtlantis"></parameter>
```

Credentials extracted:

```
arthur : KingOfAtlantis
```

> **Config files as credential stores:** enterprise middleware commonly stores integration credentials (SMTP, database, API keys) in plaintext XML or INI files. Application config is rarely treated as secret by administrators, it lives on disk with broad read permissions and is often not rotated. A traversal vulnerability that reads arbitrary files turns every config file into a potential credential dump.

## Takeaways

- **Traversal on one service can loot another.** GlassFish's traversal reached SynaMan's config directory even though SynaMan runs on a different port, both share the same filesystem.
- **Port scanners miss things; banner-grab manually.** Port 6060 (SynaMan) was missed by the initial Nmap run, and its application turned out to hold the key credential.
- **When hash cracking fails, look for plaintext elsewhere.** GlassFish's admin-keyfile hashes were crack-resistant, but the SMTP config stored the password for `arthur` in cleartext.
