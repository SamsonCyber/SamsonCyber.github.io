/**
 * Generate static catalog at public/writeups/index.html
 * Theme matches portfolio night-lab (coral / void / Archivo).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { WRITEUPS } from '../src/writeups-data.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'public', 'writeups', 'index.html')

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const sorted = [...WRITEUPS].sort((a, b) => {
  if (a.platform !== b.platform) return a.platform.localeCompare(b.platform)
  return a.name.localeCompare(b.name)
})

const htb = sorted.filter((w) => w.platform === 'HTB')
const pg = sorted.filter((w) => w.platform === 'PG' || w.platform === 'Proving Grounds')
const other = sorted.filter(
  (w) => w.platform !== 'HTB' && w.platform !== 'PG' && w.platform !== 'Proving Grounds'
)

function card(w) {
  const badge =
    w.platform === 'HTB'
      ? 'htb'
      : w.platform === 'PG' || w.platform === 'Proving Grounds'
        ? 'pg'
        : 'os'
  const tags = (w.tags || [])
    .slice(0, 4)
    .map((t) => `<span class="tag">${esc(t)}</span>`)
    .join('')
  return `<a class="card" href="./${esc(w.slug)}.html">
  <span class="badge ${badge}">${esc(w.platform)}</span>
  ${w.os ? `<span class="badge os">${esc(w.os)}</span>` : ''}
  <span class="card-title">${esc(w.name)}</span>
  <div class="tags">${tags}</div>
</a>`
}

function section(title, items) {
  if (!items.length) return ''
  return `<section class="index-section">
  <h2>${esc(title)} <span class="count">(${items.length})</span></h2>
  <div class="grid">${items.map(card).join('\n')}</div>
</section>`
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#0e1014">
<title>CTF Writeups | Samson Laird</title>
<meta name="description" content="Hack The Box and Proving Grounds writeups by Samson Laird. Enumeration, foothold, privilege escalation. Flags redacted.">
<link rel="canonical" href="./index.html">
<link rel="stylesheet" href="./style.css">
</head>
<body>
  <header class="topbar">
    <a class="home" href="../">Portfolio</a>
    <span class="brand">
      <a class="home" href="https://profile.hackthebox.com/profile/019c8240-5890-72f0-8ff8-e8b4e1792092" rel="noopener noreferrer" target="_blank" style="color:var(--coral);letter-spacing:0.12em">HTB profile</a>
      · Writeups
    </span>
  </header>
  <main class="index">
    <h1>CTF Writeups</h1>
    <p class="lede">Walkthroughs of retired Hack The Box and Proving Grounds machines: enumeration, foothold, privilege escalation. Flags, hashes, and credentials are redacted. ${sorted.length} boxes.</p>
    ${section('Hack The Box', htb)}
    ${section('Proving Grounds', pg)}
    ${section('Other', other)}
  </main>
  <footer class="foot">
    Samson Laird · St. Louis ·
    <a href="https://profile.hackthebox.com/profile/019c8240-5890-72f0-8ff8-e8b4e1792092" rel="noopener noreferrer" target="_blank">HTB profile</a>
    · CTF notes
  </footer>
</body>
</html>
`

fs.writeFileSync(out, html, 'utf8')
console.log('Wrote', out, 'with', sorted.length, 'writeups')

// Point article back-links at the catalog (not dead #writeups)
const dir = path.join(root, 'public', 'writeups')
let fixed = 0
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.html') || name === 'index.html') continue
  const p = path.join(dir, name)
  let t = fs.readFileSync(p, 'utf8')
  const next = t
    .replaceAll('href="../index.html#writeups"', 'href="./index.html"')
    .replaceAll("href='../index.html#writeups'", "href='./index.html'")
  if (next !== t) {
    fs.writeFileSync(p, next, 'utf8')
    fixed++
  }
}
console.log('Fixed back-links in', fixed, 'pages')
