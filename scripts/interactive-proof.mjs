import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const base = process.argv[2] || 'http://127.0.0.1:4177/'
const scratch = process.argv[3]
fs.mkdirSync(scratch, { recursive: true })
const browser = await chromium.launch()
const errors = []

// Desktop interactive
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => errors.push(String(e)))
await page.goto(base, { waitUntil: 'networkidle', timeout: 45000 })
await page.waitForTimeout(800)

// Filters
const allCount = await page.locator('.project').count()
await page.locator('.filter-btn[data-lane="security"]').click()
await page.waitForTimeout(200)
const secCount = await page.locator('.project:not([hidden])').count()
// hidden attribute used? our code re-renders so count of .project
const secCount2 = await page.locator('.project').count()
await page.locator('.filter-btn[data-lane="trading"]').click()
await page.waitForTimeout(200)
const tradeCount = await page.locator('.project').count()
await page.locator('.filter-btn[data-lane="all"]').click()
await page.waitForTimeout(200)
const all2 = await page.locator('.project').count()

// Nav click
await page.locator('a[href="#approach"]').click()
await page.waitForTimeout(400)
const approachVisible = await page.locator('#approach').isVisible()

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
mobile.on('pageerror', e => errors.push('mobile:' + e))
await mobile.goto(base, { waitUntil: 'networkidle' })
await mobile.waitForTimeout(900)
const mTitle = await mobile.locator('#hero-title').innerText()
const mEmail = await mobile.locator('a[href^="mailto:"]').count()
await mobile.screenshot({ path: path.join(scratch, 'mobile-hero.png') })
await mobile.locator('#work').scrollIntoViewIfNeeded()
await mobile.waitForTimeout(400)
await mobile.screenshot({ path: path.join(scratch, 'mobile-projects.png') })

const report = {
  allCount, secCount2, tradeCount, all2, approachVisible,
  mTitle: mTitle.trim(), mEmail, errors,
  filterOk: secCount2 > 0 && tradeCount >= 1 && all2 === allCount,
  mobileOk: mTitle.includes('SAMSON') && mEmail > 0,
}
fs.writeFileSync(path.join(scratch, 'interactive.log'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (errors.length || !report.filterOk || !report.mobileOk) process.exit(1)
console.log('INTERACTIVE_OK')
await browser.close()
