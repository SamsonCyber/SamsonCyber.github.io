# Writeup Enhancement Progress

**STATUS: 101 / 101 enhanced.** All boxes have a 0xdf/IppSec-style rewrite with Overview,
phased sections, "why it works" callouts, and Takeaways. All build clean; 0 secrets leak to
HTML (build `sanitize()` redacts hashes/flags as a safety net over the manual ‹redacted›).

Source of truth: `enhanced/<slug>.md` overrides raw vault notes in `build_writeups.py`.

## Screenshot punch-list (revisit with images)

These boxes hinge on something visual that prose can't fully carry. Highest value first.

### BloodHound graphs (AD attack paths)
- forest — svc-alfresco → Account Operators → Exchange Windows Permissions → DCSync
- sauna — svc_loanmgr GetChanges/GetChangesAll (DCSync)
- pg-resourced — L.Livingstone GenericAll over RESOURCEDC$ (RBCD)
- pg-heist — enox → Web Admins → svc_apache$ (gMSA) → SeRestorePrivilege
- pg-hokkaido — hrapp-service GenericWrite → Hazel.Green; IT Group → Molly.Smith
- pg-nagoya — Fiona.Clark → Kerberoast → svc_mssql
- pg-vault — anirudh write edge to Default Domain Policy

### Reverse engineering / GUI exploitation
- cascade — dnSpy paused on CascAudit.exe decrypt breakpoint
- falafel — Gimp raw import (RGB565, 1176x885) + rendered framebuffer revealing password (had 3 original embeds)
- pg-mice — RemoteMouse "Image Transfer Folder" Save-As dialog (the LPE)
- pg-nukem — DOSBox `SHELL:Redirect output to c:/etc/sudoers`
- pg-medjed — BarracudaDrive /fs/ filesystem browser scope

### Web GUI flows
- monitored — Nagios XI Core Config Manager custom command
- servmon — NSClient++ web UI scripts/scheduler
- bashed — phpbash in-browser terminal
- pg-shenzi / pg-levram(Gerapy) / pg-cockpit(web terminal) / pg-medjed
- pg-dvr4 — DVR 4.0 control panel (viewer user)
- analytics — Metabase login (minor)

### Burp request/response (the "money shot")
- secnotes — CSRF send + confirmed:false→true toggle
- pg-boolean — confirmed:false→true mass assignment
- pg-access — .htaccess+.bypass upload pair; whoami /priv SeManageVolume
- pg-xposedapi — X-Forwarded-For:127.0.0.1 403→404 WAF bypass
- pg-wheels — XPath injection request + password dump
- pg-law — path swap /htmLawedTest.php → / with id output
- pg-postfish — netcat listener showing URL-encoded POST creds
- pg-clue — curl traversal vs 127.0.0.1:4444
- pg-sorcerer — authorized_keys with/without command= restriction
- pg-mzeeav — /backups listing + upload.php source side-by-side
- pg-fantastic — sqlite datasource encrypted→decrypted password
- tartarsauce — WPScan output + readme version forgery
- timelapse — PowerShell history file creds
- flight — Chisel-tunneled internal dev site + ASPX webshell upload
- poison — VNC root X desktop
- pg-hutch — LDAP description field with password
- pg-roquefort — Gitea auto-created repo + incoming shell

## Incomplete source notes (revisit to finish the box, then re-enhance)
Written faithfully up to where the notes stop, with an in-progress `> **Note:**` callout.
- pandora — stops at confirmed Pandora FMS SQLi
- htb-jeeves — stops at Jenkins /askjeeves discovery (no exploit/privesc)
- htb-acute — ends at awallace added to Site_Admin (no explicit root flag step)
- htb-tabby — stops at lxd-alpine-builder need (no container import/mount)
- htb-tartarsauce — stops at backuperer cron discovery
- htb-servmon — NSClient++ privesc unstable; no confirmed root
- pg-exghost — recon + CVE-2021-22204 id only (no exploit)
- pg-fired — Nmap + Openfire CVE-2023-32315 version only
- pg-hawat — source review only (no SQLi payload/shell)
- pg-hunit — stops at SSH login as dademola (no privesc)
- pg-muddy — stops at XXE /etc/passwd dump (no privesc)
- pg-roquefort — run-parts PATH hijack placed; no confirmed root
- pg-nagoya — Silver Ticket forged; final MSSQL/proof not documented
- pg-fish — stops at SynaMan cred extraction (no shell/privesc)

## Empty source artifacts (cosmetic gaps, box still written)
- pg-xposedapi — Nmap.md empty; proof.txt value not recorded
- pg-algernon — proof.txt not recorded; SmarterMail version-id step undocumented
- pg-craft — Nmap.md empty (chain reconstructed from port 80 artifacts)
