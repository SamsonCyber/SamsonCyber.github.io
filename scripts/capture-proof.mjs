/**
 * Dual launch + screenshots for goal verification.
 * Usage: node scripts/capture-proof.mjs [baseUrl] [scratchDir]
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const base = process.argv[2] || 'http://127.0.0.1:4177/'
const scratch =
  process.argv[3] ||
  process.env.SCRATCH ||
  path.join(process.env.TEMP || '/tmp', 'portfolio-proof')

fs.mkdirSync(scratch, { recursive: true })

const browser = await chromium.launch()
const errors = []

async function runOnce(label, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: opts.reducedMotion || 'no-preference',
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${label}: ${e}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${label} console: ${msg.text()}`)
  })
  await page.goto(base, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(1000)
  const title = (await page.locator('#hero-title').innerText()).trim()
  const mailto = await page.locator('a[href^="mailto:"]').count()
  const github = await page.locator('a[href*="github.com/SamsonCyber"]').count()
  const linkedin = await page.locator('a[href*="linkedin.com/in/samsonlaird"]').count()
  const mode = await page.evaluate(() => document.documentElement.dataset.motion || '')
  const bodyText = await page.locator('body').innerText()
  const ok =
    title.includes('SAMSON') && mailto > 0 && github > 0 && linkedin > 0 && bodyText.length > 200
  const logPath = path.join(scratch, `${label}.log`)
  fs.writeFileSync(
    logPath,
    [
      `url=${base}`,
      `title=${JSON.stringify(title)}`,
      `mailto=${mailto}`,
      `github=${github}`,
      `linkedin=${linkedin}`,
      `motion=${mode}`,
      `bodyChars=${bodyText.length}`,
      ok ? 'ASSERT_OK' : 'ASSERT_FAIL',
    ].join('\n')
  )
  if (label === 'launch-1') {
    await page.screenshot({ path: path.join(scratch, 'hero.png') })
    await page.locator('#work').scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(scratch, 'projects.png') })
  }
  if (opts.reducedMotion === 'reduce') {
    await page.screenshot({ path: path.join(scratch, 'hero-reduced.png') })
    fs.appendFileSync(path.join(scratch, 'reduced-motion.log'), `\nbrowser motion=${mode}\n`)
  }
  await context.close()
  return { ok, title, mode }
}

const a = await runOnce('launch-1')
const b = await runOnce('launch-2')
const c = await runOnce('launch-reduced', { reducedMotion: 'reduce' })

fs.writeFileSync(
  path.join(scratch, 'playwright-console.log'),
  [
    `errors=${JSON.stringify(errors)}`,
    `launch1=${a.ok}`,
    `launch2=${b.ok}`,
    `reduced_mode=${c.mode}`,
    errors.length === 0 && a.ok && b.ok ? 'PW_OK' : 'PW_FAIL',
  ].join('\n')
)

await browser.close()
if (errors.length || !a.ok || !b.ok) {
  console.error('PW_FAIL', errors)
  process.exit(1)
}
console.log('PW_OK', a.title, c.mode)
