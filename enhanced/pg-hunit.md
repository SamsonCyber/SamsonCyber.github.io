#Linux #API #InfoDisclosure #CredentialReuse #SSH

## Overview

Hunit runs a small web application on port 8080 that exposes a JSON API with no authentication, including an endpoint that returns every user's plaintext credentials. One of those accounts has SSH access to the box on a non-standard port. These notes cover reconnaissance and initial access; the privilege escalation path is not documented.

> **Note:** these notes are incomplete, covers recon through SSH foothold only; privilege escalation and root are not documented.

## Recon

### Port Scan

```sh
PORT      STATE SERVICE     VERSION
8080/tcp  open  http-proxy
12445/tcp open  netbios-ssn Samba smbd 4.6.2
18030/tcp open  http        Apache httpd 2.4.46 ((Unix))
43022/tcp open  ssh         OpenSSH 8.4 (protocol 2.0)
```

The layout is unusual: SSH on 43022, SMB on 12445, two separate HTTP services. Port 18030 served a page titled "Whack A Mole!" with no obvious attack surface. Port 8080 was the interesting one.

### API Enumeration

Browsing port 8080 served a landing page of poems. Checking the page source revealed a link to `/api/`. Following that exposed a self-describing route listing:

```
"/api/"
"/article/"
"/article/?"
"/user/"
"/user/?"
```

> **Why unauthenticated API route listing matters:** a route index like this hands you the full application map. The `/user/` endpoint in particular is a red flag, user resources should require authentication before returning any data.

Visiting `/api/user/` returned every account in the system with passwords in plaintext:

```json
login: "rjackson"    password: "yYJcgYqszv4aGQ"    description: "Editor"
login: "jsanchez"    password: "d52cQ1BzyNQycg"     description: "Editor"
login: "dademola"    password: "ExplainSlowQuest110" description: "Admin"
login: "jwinters"    password: "KTuGcSW6Zxwd0Q"     description: "Editor"
login: "jvargas"     password: "OuQ96hcgiM5o9w"     description: "Editor"
```

> **Plaintext passwords in an API response:** this is a design failure, not a misconfiguration. The database is storing (or the API is returning) unhashed credentials. Any unauthenticated read of this endpoint is a full credential dump for every account. The `Admin` role made `dademola` the priority target.

## Foothold

### SSH as dademola

The editor accounts could be API credentials with no system access, but the Admin account `dademola` had a notably different password format. Testing it against the non-standard SSH port:

```sh
ssh -p 43022 dademola@192.168.180.125
dademola@192.168.180.125's password:
[dademola@hunit ~]$ whoami
dademola
```

SSH authenticated successfully on the first attempt.

## Takeaways

- **Always check API endpoints for unauthenticated access before anything else.** A single GET to `/api/user/` replaced every other recon step here.
- **Non-standard ports hide services from careless scanners.** SSH on 43022 would be missed by a default `nmap` scan without `-p-` or explicit port ranges.
- **Admin-flagged accounts in credential dumps are the priority target.** `dademola`'s "Admin" description made it the obvious choice when testing for system access.
