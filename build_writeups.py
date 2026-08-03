#!/usr/bin/env python3
"""Generate a 0xdf-style static writeup site from the OSCP Obsidian vault.

Reads HTB + Proving Grounds box notes (Engagement.md / *(Engagement).md),
sanitizes secrets, converts Markdown -> HTML, and renders each into a
dark, code-focused article page plus an index. Output: public/writeups/.
"""
import os, re, html, glob, shutil, datetime, json
import markdown

VAULT = r"C:\Users\shotg\OneDrive\Desktop\OSCP\Practice Boxes"
OUT = os.path.join(os.path.dirname(__file__), "public", "writeups")
# Hand-written 0xdf-style rewrites override the raw vault notes when present.
ENH = os.path.join(os.path.dirname(__file__), "enhanced")

SOURCES = [
    ("HTB", "Linux/Windows", os.path.join(VAULT, "HTB")),
    ("PG",  "Linux",         os.path.join(VAULT, "PG", "Linux")),
    ("PG",  "Windows",       os.path.join(VAULT, "PG", "Windows")),
]

# ── Sanitization ────────────────────────────────────────────
# Best-effort redaction of flags, hashes, and obvious cracked creds.
# IPs (retired/lab ranges) are intentionally kept.
RED = "‹redacted›"

STOP = {"root","admin","administrator","guest","user","users","public","private",
        "type","comment","disk","ipc","name","group","true","false","null","none",
        "password","passwd","login","share","domain","localhost","kali","www","http",
        "https","tcp","udp","open","closed","yes","no","system","local","service"}

def collect_secrets(text):
    """Harvest high-confidence secret values so we can redact every reuse."""
    found = set()
    def keep(v):
        v = v.strip().strip('\'"`')
        if 3 <= len(v) <= 32 and v.lower() not in STOP \
           and not v.isdigit() and not re.search(r"[\\/.]", v) \
           and re.match(r"^[\w@!$%^&*+=#-]+$", v):
            found.add(v)
    # lone "user:password" reveal lines (e.g. inside a creds code block)
    for m in re.finditer(r"(?m)^\s*[A-Za-z0-9._-]{2,}:([^\s:]{3,32})\s*$", text):
        keep(m.group(1))
    # explicit assignments / flags
    for pat in [r'\$?password\s*[=:]\s*["\']?([^\s"\'<>]{3,32})',
                r'-ldappass\s+([^\s"\'<>]{3,32})',
                r'(?:^|\s)-p\s+["\']?([^\s"\'<>]{3,32})',
                r'(?:^|\s)-P\s+["\']?([^\s"\'<>]{3,32})']:
        for m in re.finditer(pat, text, flags=re.I | re.M):
            keep(m.group(1))
    # hashcat/john "hash:plaintext" cracked output
    for m in re.finditer(r"(?m)^\s*[^\s:]{8,}:([^\s:]{3,32})\s*$", text):
        keep(m.group(1))
    return found

def sanitize(text):
    # Kerberos AS-REP / TGS hashes
    text = re.sub(r"\$krb5(?:asrep|tgs)\$[^\s`]+", "$krb5$" + RED, text)
    # any hex blob >= 32 chars (flags, NTLM/LM, MD5, SHA) — single rule covers all lengths
    text = re.sub(r"(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])", RED, text)
    # flag{...} / HTB{...} markers
    text = re.sub(r"\b(?:HTB|flag|OS|PG)\{[^}]*\}", RED, text, flags=re.I)
    # collect plaintext secrets, then redact every occurrence (catches reuse in commands)
    for secret in sorted(collect_secrets(text), key=len, reverse=True):
        text = re.sub(r"(?<![\w])" + re.escape(secret) + r"(?![\w])", RED, text)
    return text

# ── Markdown helpers ────────────────────────────────────────
def strip_obsidian(text):
    text = re.sub(r"!\[\[[^\]]+\]\]", "", text)          # image embeds (dead refs)
    text = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", text)  # [[a|b]] -> b
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)      # [[a]] -> a
    return text

TAG_RE = re.compile(r"#([A-Za-z0-9_\-]+)")

def extract_tags(text):
    lines = text.splitlines()
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines) and lines[i].lstrip().startswith("#") and len(TAG_RE.findall(lines[i])) >= 2 \
       and not lines[i].lstrip().startswith("# "):
        tags = TAG_RE.findall(lines[i])
        del lines[i]
        return tags, "\n".join(lines)
    return [], text

# ── Best-effort auto-sectioning ─────────────────────────────
# Insert Recon / Foothold / Privesc / Root headings at detected transitions
# so each page gets a 0xdf-style TOC. Headings are guessed; conservative cues.
PHASE_CUES = [
    (1, "Initial Foothold", re.compile(
        r"reverse shell|\bwe (?:get|got|have|now have) (?:a |our )?shell|web ?shell|"
        r"msfvenom|nc -e|/bin/bash -i|bash -i|evil-winrm|remote code execution|\bRCE\b|"
        r"upload[^\n]{0,30}shell|\bfoothold\b|got (?:a )?(?:user|low-priv)", re.I)),
    (2, "Privilege Escalation", re.compile(
        r"sudo -l|\bSUID\b|privilege escalation|\bprivesc\b|linpeas|winpeas|GenericAll|"
        r"\bDCSync\b|SeImpersonate|GTFOBins|kernel exploit|\bcapabilities\b|unquoted service|"
        r"AlwaysInstallElevated|Kerberoast|AS-REP|RBCD|\bACL abuse\b", re.I)),
    (3, "Root", re.compile(
        r"root\.txt|proof\.txt|Box Rooted|nt authority\\system|System Owned", re.I)),
]

def split_blocks(text):
    lines = text.split("\n")
    blocks, i, n = [], 0, len(lines)
    while i < n:
        if not lines[i].strip():
            i += 1; continue
        if lines[i].lstrip().startswith("```"):
            buf = [lines[i]]; i += 1
            while i < n and not lines[i].lstrip().startswith("```"):
                buf.append(lines[i]); i += 1
            if i < n:
                buf.append(lines[i]); i += 1
            blocks.append("\n".join(buf))
        else:
            buf = []
            while i < n and lines[i].strip() and not lines[i].lstrip().startswith("```"):
                buf.append(lines[i]); i += 1
            blocks.append("\n".join(buf))
    return blocks

def autosection(text):
    # Leave files that already have real structure alone.
    if len(re.findall(r"(?m)^#{1,3}\s+\S", text)) >= 2:
        return text
    blocks = split_blocks(text)
    if not blocks:
        return text
    out, maxphase = ["## Recon"], 0
    for block in blocks:
        best, best_h = 0, None
        for ph, head, rx in PHASE_CUES:
            if ph > maxphase and ph > best and rx.search(block):
                best, best_h = ph, head
        if best_h:
            out.append("## " + best_h)
            maxphase = best
        out.append(block)
    return "\n\n".join(out)

def find_writeup(box_dir):
    eng = os.path.join(box_dir, "Engagement.md")
    if os.path.isfile(eng):
        return eng
    hits = glob.glob(os.path.join(glob.escape(box_dir), "*(Engagement)*.md"))
    return hits[0] if hits else None

# ── Multi-file boxes (older note style) ─────────────────────
# Some boxes have no single Engagement.md; the solve lives across per-port /
# per-topic notes (Nmap.md, "Port 80 - HTTP.md", Enumeration.md, Creds.md...).
# Stitch those into one markdown doc, ordering recon -> ports -> privesc/loot.
SCAN_ONLY = ("nmap", "rustscan", "masscan", "autorecon")  # alone => not a writeup
RECON_HINT = ("nmap", "scan", "recon", "enumeration", "enum")
LATE_HINT = ("cred", "privesc", "priv-esc", "escalat", "loot", "root.txt",
             "proof", "post-ex", "postex", "flag", "shell", "foothold", "user.txt")

def section_sort_key(relpath):
    low = os.path.splitext(os.path.basename(relpath))[0].lower()
    m = re.search(r"port\s*0*(\d+)", low)
    if any(h in low for h in RECON_HINT):
        grp = 0
    elif low.startswith("port") or m:
        grp = 1
    elif any(h in low for h in LATE_HINT):
        grp = 3
    else:
        grp = 2
    return (grp, int(m.group(1)) if m else 10**6, low)

def gather_multifile(box_dir):
    files = []
    for p in glob.glob(os.path.join(glob.escape(box_dir), "**", "*.md"), recursive=True):
        try:
            txt = open(p, encoding="utf-8", errors="ignore").read().strip()
        except OSError:
            continue
        if txt:
            files.append((os.path.relpath(p, box_dir), txt))
    if not files:
        return None
    # Skip recon-only stubs: need real content beyond a port scan.
    meaningful = sum(len(t) for rel, t in files
                     if not any(s in os.path.basename(rel).lower() for s in SCAN_ONLY))
    if meaningful < 200:
        return None
    files.sort(key=lambda ft: section_sort_key(ft[0]))
    parts = []
    for rel, txt in files:
        heading = os.path.splitext(os.path.basename(rel))[0]
        parts.append("## " + heading + "\n\n" + txt)
    return "\n\n".join(parts)

def load_box(box_dir):
    wf = find_writeup(box_dir)
    if wf:
        raw = open(wf, encoding="utf-8").read()
        return raw if len(raw.strip()) >= 80 else None
    return gather_multifile(box_dir)

def guess_os(platform, group, tags, body):
    t = " ".join(tags).lower()
    if platform == "PG":
        return group
    if "windows" in t or "activedirectory" in t or "ad" in [x.lower() for x in tags]:
        return "Windows"
    if "linux" in t:
        return "Linux"
    if re.search(r"\bevil-winrm\b|\bsmbclient\b|\bAdministrator\b|\bSeImpersonate\b", body):
        return "Windows"
    return "Linux"

def first_ip(body):
    m = re.search(r"\b(?:10\.10\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b", body)
    return m.group(0) if m else ""

# ── Templates ───────────────────────────────────────────────
def page_html(box, platform, osname, tags, ip, body_html, toc_html, enhanced=False):
    chip = "".join(f'<span class="tag">{html.escape(t)}</span>' for t in tags)
    plat_class = platform.lower()
    deep = '<span class="badge deep">in-depth</span>' if enhanced else ''
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(box)} &middot; Writeups</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:wght@400;500&family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
</head>
<body>
<header class="topbar">
  <a class="home" href="../index.html#writeups">&larr; all writeups</a>
  <span class="brand">SAMSON &middot; CTF</span>
</header>
<main class="article">
  <div class="boxhead">
    <div class="bh-left">
      <span class="badge {plat_class}">{platform}</span>
      <span class="badge os">{html.escape(osname)}</span>
      {deep}
    </div>
    <h1>{html.escape(box)}</h1>
    {f'<div class="meta">Target: <code>{html.escape(ip)}</code></div>' if ip else ''}
    <div class="tags">{chip}</div>
  </div>
  <div class="layout">
    <nav class="toc">{toc_html}</nav>
    <article class="body">{body_html}</article>
  </div>
</main>
<footer class="foot">Samson Laird &middot; retired-machine writeups &middot; secrets redacted</footer>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>hljs.highlightAll();</script>
</body>
</html>
"""

def index_html(cards):
    # The writeup index now lives in the main page's filterable grid. This page is
    # kept only as a redirect so any old bookmark lands on that grid.
    return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=../index.html#writeups">
<link rel="canonical" href="../index.html#writeups">
<title>CTF Writeups &middot; Samson Laird</title>
<script>location.replace('../index.html#writeups')</script>
</head>
<body style="background:#040a12;color:#7d8da0;font-family:sans-serif;padding:40px">
Redirecting to <a href="../index.html#writeups" style="color:#5aa4ff">all writeups</a>&hellip;
</body>
</html>
"""

def card_html(box, platform, osname, slug, tags, enhanced=False):
    chip = "".join(f'<span class="tag">{html.escape(t)}</span>' for t in tags[:4])
    deep = '<span class="badge deep">in-depth</span>' if enhanced else ''
    return f"""<a class="card{' is-deep' if enhanced else ''}" href="{slug}.html">
      <div class="card-top"><span class="badge {platform.lower()}">{platform}</span><span class="badge os">{html.escape(osname)}</span>{deep}</div>
      <h3>{html.escape(box)}</h3>
      <div class="tags">{chip}</div>
    </a>"""

# ── TOC + heading anchors ───────────────────────────────────
def add_anchors_and_toc(body_html):
    headings = re.findall(r"<h([23])>(.*?)</h\1>", body_html)
    toc = []
    def repl(m):
        level, text = m.group(1), m.group(2)
        anchor = re.sub(r"[^a-z0-9]+", "-", re.sub("<[^>]+>", "", text).lower()).strip("-") or "s"
        toc.append((level, anchor, re.sub("<[^>]+>", "", text)))
        return f'<h{level} id="{anchor}">{text}</h{level}>'
    body_html = re.sub(r"<h([23])>(.*?)</h\1>", repl, body_html)
    if not toc:
        return body_html, '<div class="toc-empty">walkthrough</div>'
    items = "".join(
        f'<a class="lvl{l}" href="#{a}">{html.escape(t)}</a>' for l, a, t in toc
    )
    return body_html, items

# ── Build ───────────────────────────────────────────────────
def slugify(platform, box):
    return platform.lower() + "-" + re.sub(r"[^a-z0-9]+", "-", box.lower()).strip("-")

def main():
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, "*.html")) + glob.glob(os.path.join(OUT, "*.css")):
        try:
            os.remove(old)
        except OSError:
            pass

    md = markdown.Markdown(extensions=["fenced_code", "tables"])
    entries = []
    search_blobs = {}  # slug -> normalized lowercase text for the in-page search
    only = [a.lower() for a in os.environ.get("ONLY", "").split(",") if a.strip()]

    for platform, group, root in SOURCES:
        if not os.path.isdir(root):
            continue
        for box_dir in sorted(glob.glob(os.path.join(root, "*"))):
            if not os.path.isdir(box_dir):
                continue
            box_raw = os.path.basename(box_dir)
            if "(Unfinished)" in box_raw or "(Unfinshed)" in box_raw:
                continue
            box = re.sub(r"\s*\(.*?\)\s*", "", box_raw).strip()
            if only and box.lower() not in only:
                continue
            slug = slugify(platform, box)
            enh = os.path.join(ENH, slug + ".md")
            enhanced = os.path.isfile(enh)
            if enhanced:
                raw = open(enh, encoding="utf-8").read()
            else:
                raw = load_box(box_dir)
            if raw is None:
                continue
            tags, raw = extract_tags(raw)
            raw = strip_obsidian(raw)
            raw = sanitize(raw)
            raw = autosection(raw)
            osname = guess_os(platform, group, tags, raw)
            ip = first_ip(raw)
            # Build a normalized search blob (name + tags + OS + body text) so the
            # in-page search matches services, ports, CVEs, tools, and techniques.
            blob = box + " " + " ".join(tags) + " " + osname + " " + platform + " " + raw
            blob = re.sub(r"[`#*|>_\[\]()]", " ", blob)
            blob = re.sub(r"\s+", " ", blob).strip().lower()
            search_blobs[slug] = blob[:8000]
            md.reset()
            body_html = md.convert(raw)
            body_html, toc = add_anchors_and_toc(body_html)
            with open(os.path.join(OUT, slug + ".html"), "w", encoding="utf-8") as f:
                f.write(page_html(box, platform, osname, tags, ip, body_html, toc, enhanced))
            entries.append((platform, osname, box, slug, tags, enhanced))

    css_src = os.path.join(os.path.dirname(__file__), "writeups.css")
    if os.path.isfile(css_src):
        shutil.copyfile(css_src, os.path.join(OUT, "style.css"))

    entries.sort(key=lambda e: (e[0], e[2].lower()))
    cards = [card_html(box, plat, osn, slug, tags, enh) for plat, osn, box, slug, tags, enh in entries]
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(index_html(cards))

    # Emit a JS module the canvas landing page imports to render the
    # filterable in-page writeup grid (platform + OS).
    data = [{"slug": slug, "name": box, "platform": plat, "os": osn,
             "tags": tags[:4], "search": search_blobs.get(slug, "")}
            for plat, osn, box, slug, tags, enh in entries]
    js = ("// AUTO-GENERATED by build_writeups.py - do not edit.\n"
          "export const WRITEUPS = " + json.dumps(data, ensure_ascii=False) + ";\n")
    with open(os.path.join(os.path.dirname(__file__), "src", "writeups-data.js"),
              "w", encoding="utf-8") as f:
        f.write(js)

    print(f"Generated {len(entries)} writeups -> {OUT}")
    for plat in ("HTB", "PG"):
        n = sum(1 for e in entries if e[0] == plat)
        print(f"  {plat}: {n}")

if __name__ == "__main__":
    main()
