#Linux #SourceCodeReview #SQLi #DefaultCreds #PHP #RCE #credentialhunting

## Overview

Hawat is a Linux box running three HTTP services on non-standard ports: an Issue Tracker Java application on port 17445, an nginx server on port 30455, and an Apache/PHP server on port 50080. The Apache server hosts a `/cloud` directory protected by default credentials, which contains a downloadable zip of the Issue Tracker's Java source code. Reviewing that source reveals both a hardcoded database password and an injectable SQL query. The SQLi endpoint runs on the Java app on port 17445 and can be leveraged for code execution through a file write to the PHP server's document root.

> **Note:** these notes are incomplete, they document the recon, source code download, credential and SQLi discovery, and the document root path from phpinfo. The actual SQLi exploitation, shell delivery, and privilege escalation steps are not recorded. Written as in-progress.

## Recon

### Nmap

```sh
PORT      STATE SERVICE VERSION
22/tcp    open  ssh     OpenSSH 8.4
17445/tcp open  http    [Issue Tracker - Java/Spring]
30455/tcp open  http    nginx 1.18.0
50080/tcp open  http    Apache httpd 2.4.46 ((Unix) PHP/7.4.15)
```

Port 17445 serves a Java-based Issue Tracker with login and register endpoints visible in the nmap response body. Port 30455 is nginx serving a static W3.CSS template page. Port 50080 is Apache with PHP 7.4.15.

### Discovering /cloud on Port 50080

FeroxBuster finds a `/cloud` directory on port 50080. The directory presents a login portal accepting:

```
admin:admin
```

> **Default credentials before enumeration.** Before fuzzing or inspecting any further, `admin:admin` on an internal-looking panel is the single cheapest check. Here it works immediately, granting download access to the application source.

After logging in, a zip file is available for download. Extracting it reveals the Issue Tracker Java source code.

### phpinfo Document Root

FeroxBuster also finds `/phpinfo.php` on port 50080:

```
Document Root: /srv/http
```

This will be relevant for writing PHP files if the SQLi allows file writes.

## Source Code Analysis

### Hardcoded Database Credentials

Inside the extracted zip, navigating to:

```
issuetracker/src/main/java/com/issue/tracker/issues/IssueController.java
```

The `checkByPriority` endpoint contains hardcoded database credentials:

```java
Properties connectionProps = new Properties();
connectionProps.put("user", "issue_user");
connectionProps.put("password", "ManagementInsideOld797");
conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/issue_tracker", connectionProps);
```

Credentials found:

```
issue_user:ManagementInsideOld797
```

### SQL Injection in checkByPriority

The same function constructs a query by concatenating user input directly:

```java
String query = "SELECT message FROM issue WHERE priority='" + priority + "'";
Statement stmt = conn.createStatement();
stmt.executeQuery(query);
```

> **Why this query is injectable:** the `priority` parameter from the HTTP request is placed directly into the SQL string without parameterization or escaping. An attacker can break out of the string literal with a single quote and inject arbitrary SQL, including `UNION SELECT`, `INTO OUTFILE`, or stacked queries depending on the MySQL configuration. The `INTO OUTFILE` variant is particularly relevant here since the MySQL process may have write access to `/srv/http`, the Apache document root revealed by phpinfo.

The vulnerable endpoint is:

```
GET /issue/checkByPriority?priority=<injection>
```

## Takeaways

- **Non-standard ports get full enumeration.** Three HTTP services on three different ports, each with distinct attack surfaces. Skipping any one of them would have broken the chain.
- **Source code zip files handed out via default creds are a complete roadmap.** Hardcoded passwords, injectable queries, and database schema, all in the first file reviewed.
- **phpinfo leaks the document root**, which turns a MySQL `INTO OUTFILE` SQLi into a PHP webshell write primitive.
- **Credential reuse is worth checking.** `issue_user:ManagementInsideOld797` is a MySQL user, but the same password may authenticate to SSH or other services on the host.
