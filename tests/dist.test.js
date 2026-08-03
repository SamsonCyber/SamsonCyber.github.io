/**
 * Structural checks against the built static entry (shipped path).
 * Run after `npm run build`.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const distHtml = path.join(root, 'dist', 'index.html')

describe('static dist entry', () => {
  it('dist/index.html exists and is non-empty', () => {
    assert.ok(fs.existsSync(distHtml), 'run npm run build first')
    const html = fs.readFileSync(distHtml, 'utf8')
    assert.ok(html.length > 500)
  })

  it('ships SAMSON title and real contact hrefs (not placeholders)', () => {
    const html = fs.readFileSync(distHtml, 'utf8')
    assert.match(html, /SAMSON/)
    assert.match(html, /mailto:shotgunsamm6@gmail\.com/)
    assert.match(html, /github\.com\/SamsonCyber/i)
    assert.match(html, /linkedin\.com\/in\/samsonlaird/i)
    assert.match(html, /profile\.hackthebox\.com\/profile\/019c8240-5890-72f0-8ff8-e8b4e1792092/)
    assert.doesNotMatch(html, /example\.com/)
    assert.doesNotMatch(html, /your-email|placeholder@/i)
  })

  it('embeds flagship projects in static HTML for no-JS and crawlers', () => {
    const html = fs.readFileSync(distHtml, 'utf8')
    for (const name of ['Garbleworks', 'StegOFF', 'Agentic DM Gateway', 'Raven', 'Cantina']) {
      assert.match(html, new RegExp(name))
    }
    assert.match(html, /St\. Louis, Missouri/)
    assert.match(html, /Environmental Restoration LLC/)
  })


  it('loads relative asset paths suitable for GitHub Pages', () => {
    const html = fs.readFileSync(distHtml, 'utf8')
    // Vite base './' produces ./assets/...
    assert.match(html, /\.\/assets\/index-[^"]+\.js/)
    assert.match(html, /\.\/assets\/index-[^"]+\.css/)
  })

  it('keeps writeups public tree available in dist', () => {
    const w = path.join(root, 'dist', 'writeups', 'index.html')
    assert.ok(fs.existsSync(w), 'public/writeups should copy into dist')
  })

  it('writeups index is a real catalog, not a redirect to dead #writeups', () => {
    const w = path.join(root, 'dist', 'writeups', 'index.html')
    const html = fs.readFileSync(w, 'utf8')
    assert.doesNotMatch(html, /#writeups/)
    assert.doesNotMatch(html, /http-equiv=["']refresh/i)
    assert.match(html, /class=["']grid["']|class=["']card["']/)
    assert.match(html, /htb-active|Garbleworks|CTF Writeups/i)
  })
})

