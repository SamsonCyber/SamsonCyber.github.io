#Windows #Jenkins #Groovy #SMB #credentialhunting #PassTheHash #KeePass #ADS #SeImpersonate

## Overview

> **Note:** these notes are incomplete, they cover Nmap and initial directory bruteforcing of both port 80 and port 50000, up to discovery of the `/askjeeves` Jenkins endpoint. The subsequent steps (Jenkins exploitation, privilege escalation, and root) are not documented in the source notes; written as in-progress.

Jeeves is a medium Windows box. Port 80 is a decoy IIS site. The real attack surface is Jetty on port 50000, which hosts an unauthenticated Jenkins instance at `/askjeeves`.

## Recon

### Nmap

```sh
PORT      STATE SERVICE      VERSION
80/tcp    open  http         Microsoft IIS httpd 10.0
135/tcp   open  msrpc        Microsoft Windows RPC
445/tcp   open  microsoft-ds Microsoft Windows 7 - 10
50000/tcp open  http         Jetty 9.4.z-SNAPSHOT
```

IIS on port 80 presented an "Ask Jeeves" search page. Both GoBuster passes against port 80 found nothing:

```sh
gobuster dir -u http://10.129.228.112/ -w /path/to/big.txt
# Progress: 20476 / 20477 (100.00%) — zero results
```

### Port 50000, Jetty / Jenkins

The same small wordlist also returned nothing on port 50000. Switching to the larger `directory-list-2.3-medium.txt` wordlist found one directory:

```sh
gobuster dir -u http://10.129.228.112:50000/ -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt
/askjeeves  (Status: 302) --> http://10.129.228.112:50000/askjeeves/
```

> **Why the small wordlist missed it:** common-word lists prioritize short, generic path components (`admin`, `api`, `login`). Application-specific paths like `askjeeves` only appear in larger content-discovery lists. When a standard pass returns nothing, switching wordlists before giving up often reveals hidden surfaces.

Browsing to `http://10.129.228.112:50000/askjeeves/` presented a Jenkins dashboard with no authentication required.

> **Note:** these notes are incomplete, the Jenkins RCE (via Groovy script console), privilege escalation (likely KeePass credential hunting or SeImpersonate), and root steps are not documented. The chain up to an unauthenticated Jenkins instance is covered above.

## Takeaways

- **Port 50000 is a common Jetty/Jenkins default.** Always enumerate non-standard HTTP ports, not just 80 and 443.
- **The small wordlist is a starting filter, not a final answer.** When it returns nothing, escalate to medium or large lists before assuming no content exists.
- **Unauthenticated Jenkins is immediate code execution.** The Groovy script console at `/askjeeves/script` executes arbitrary code as the Jenkins process user with no credentials needed.
