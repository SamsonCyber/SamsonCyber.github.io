#Linux #SNMP #credentialhunting #SSH #SUID #PandoraFMS #SQLi #portforward

> **Note:** these are working notes captured up to the privilege-escalation enumeration, foothold as `daniel` was achieved and the root path (Pandora FMS SQL injection) identified and confirmed, but not finished. Documented faithfully as-is.

## Overview

Pandora is a medium Linux box where the real attack surface hides behind UDP. SNMP leaks a credential that gives SSH access as `daniel`; from there a localhost-only **Pandora FMS** monitoring console (reached via SSH port-forward) is the target, with a known pre-auth SQL injection. A SUID `pandora_backup` binary owned by `matt` sits waiting as the final privesc step.

## Recon

### SNMP, the Overlooked Service

TCP enumeration was unremarkable, so I walked SNMP (UDP 161), which is frequently forgotten and frequently chatty:

```
snmpwalk ...
954  runnable  sh  /bin/sh  -c sleep 30; /bin/bash -c '/usr/bin/host_check -u daniel -p ‹redacted›'
```

> **Why SNMP matters:** the `hrSWRun` table lists running processes *with their full command lines*. Admins routinely pass credentials as CLI arguments, and SNMP hands them to anyone with the (often default `public`) community string. Here it leaked a password in a process invocation.

Those credentials gave SSH as `daniel`.

## Foothold (daniel)

Two leads from local enumeration:

A SUID binary owned by `matt`, the eventual privesc target:

```
-rwsr-x--- 1 root matt 17K /usr/bin/pandora_backup
```

And an internal web service bound to localhost. I forwarded it to Kali over SSH to reach it:

```sh
ssh -L 9001:localhost:80 daniel@10.129.19.87
# http://127.0.0.1:9001/pandora_console/   ->   v7.0NG.742_FIX_PERL2020
```

## Privilege Escalation (path identified)

**Pandora FMS 7.0NG.742** has [documented critical vulnerabilities](https://www.sonarsource.com/blog/pandora-fms-742-critical-code-vulnerabilities-explained/), including an unauthenticated SQL injection in `chart_generator.php`. I confirmed the injection point:

```
http://127.0.0.1:9001/pandora_console/include/chart_generator.php?session_id='
->  SQL error ... near '''' LIMIT 1 ... mysql.php on line 114
```

> **The intended path from here:** the SQLi extracts a valid admin session from `tsessions_php`, granting the Pandora console as admin. From admin, a file-upload/exec primitive yields a shell as `matt`, and the SUID `pandora_backup` binary (which calls `tar` by relative path) is hijacked via `PATH` for root. The notes stop at the confirmed injection.

## Takeaways

- **Never skip SNMP.** UDP 161 with a default community string leaked the foothold credential in a process command line.
- **Port-forward localhost-only services.** The vulnerable Pandora console was unreachable until tunneled over SSH.
- **Version-pin your target.** `v7.0NG.742` maps directly to a public pre-auth SQLi.
