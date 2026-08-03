/**
 * Remove per-page Google Fonts links; writeups load type via style.css @import.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'writeups')
const fontLink =
  /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=[^"]+" rel="stylesheet">\s*/g
const preconnect =
  /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"><link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*/g

let n = 0
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.html') || f === 'index.html') continue
  const p = path.join(dir, f)
  let t = fs.readFileSync(p, 'utf8')
  const next = t.replace(preconnect, '').replace(fontLink, '')
  if (next !== t) {
    fs.writeFileSync(p, next)
    n++
  }
}
console.log('Stripped font links from', n, 'article pages')
