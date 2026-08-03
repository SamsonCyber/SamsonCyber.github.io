#Linux #Openfire #CVE #RCE #SSH

## Overview

Fired is a Linux box running Openfire 4.7.3, an XMPP server with a web admin console on port 9090. Openfire 4.7.3 is vulnerable to CVE-2023-32315, an authentication bypass that allows unauthenticated access to the admin plugin upload functionality, leading to remote code execution.

> **Note:** these notes are incomplete, they identify the open ports and the Openfire version, and name the CVE. No commands beyond the Nmap scan are documented; the exploit execution and post-foothold steps are not recorded. Written as in-progress.

## Recon

### Nmap

```sh
PORT     STATE SERVICE                VERSION
22/tcp   open  ssh                    OpenSSH 8.2p1 Ubuntu 4ubuntu0.11
9090/tcp open  hadoop-tasktracker     Apache Hadoop  [Openfire admin console]
9091/tcp open  ssl/hadoop-tasktracker Apache Hadoop  [Openfire admin console TLS]
```

The nmap service fingerprint misidentifies the service as Apache Hadoop, but the HTTP title and response content identify it as Openfire. Visiting port 9090 in a browser presents:

```
Openfire, Version: 4.7.3
```

### CVE Identification

Openfire 4.7.3 is vulnerable to **CVE-2023-32315**, an authentication bypass in the admin console that allows unauthenticated users to upload plugins. Since Openfire plugins are JAR files executed by the Java runtime, this is effectively an unauthenticated remote code execution primitive.

> **How CVE-2023-32315 works:** Openfire's admin console has a path traversal flaw in its setup wizard endpoint that remains accessible even after setup is complete. An attacker can use this endpoint to create a new admin account without authentication. Once authenticated as the new admin, they upload a malicious plugin JAR that executes a reverse shell when the plugin loads.

## Takeaways

- **XMPP/Openfire admin consoles should never be internet-facing.** The plugin upload mechanism is designed for legitimate extensions but becomes an RCE path when authentication can be bypassed.
- **CVE-2023-32315 affects all Openfire versions before 4.7.5.** Version fingerprinting the login page is enough to identify the vulnerability without any active exploitation attempt.
- **Nmap's service fingerprints can misclassify Java-based web apps.** When the fingerprint looks wrong (Apache Hadoop on a pentest box), visit the port directly before making assumptions.
