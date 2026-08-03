import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SITE,
  PROJECTS,
  EXPERIENCE,
  validateContent,
  isValidPublicHref,
  filterProjects,
  selectMotionMode,
  FORBIDDEN_HREF_SNIPPETS,
} from '../src/content.js'

describe('content model', () => {
  it('validates required contact fields and SAMSON title', () => {
    const r = validateContent()
    assert.equal(r.ok, true, r.errors.join('; '))
    assert.equal(SITE.titleWord, 'SAMSON')
    assert.match(SITE.contacts.email, /@/)
    assert.ok(SITE.contacts.github.includes('SamsonCyber') || SITE.contacts.github.includes('samsoncyber'))
    assert.ok(SITE.contacts.linkedin.includes('linkedin.com'))
    assert.ok(SITE.location.length > 0)
  })

  it('rejects example.com and placeholder hrefs', () => {
    assert.equal(isValidPublicHref('https://example.com/foo'), false)
    assert.equal(isValidPublicHref('https://github.com/SamsonCyber/stegoff'), true)
    assert.equal(isValidPublicHref('mailto:shotgunsamm6@gmail.com'), true)
    assert.equal(isValidPublicHref('./writeups/'), true)
    assert.equal(isValidPublicHref(null), true)
    for (const bad of FORBIDDEN_HREF_SNIPPETS) {
      assert.equal(isValidPublicHref(`https://${bad}.test/x`), false)
    }
  })

  it('features real public security projects with live links', () => {
    const must = ['garbleworks', 'stegoff', 'field-guide', 'agentic-dm-gateway']
    for (const id of must) {
      const p = PROJECTS.find((x) => x.id === id)
      assert.ok(p, `missing project ${id}`)
      assert.ok(p.href, `${id} needs href`)
      assert.ok(isValidPublicHref(p.href), `${id} href invalid`)
      assert.ok(p.href.includes('github.com'), `${id} should be github`)
    }
    const guide = PROJECTS.find((x) => x.id === 'field-guide')
    assert.ok(guide.live && guide.live.includes('github.io'))
  })

  it('includes trading lane without inventing a public trading repo', () => {
    const trading = filterProjects('trading')
    assert.ok(trading.length >= 1)
    for (const p of trading) {
      if (p.href == null) assert.ok(p.note, 'internal trading project needs note')
    }
  })

  it('filterProjects returns subsets', () => {
    assert.equal(filterProjects('all').length, PROJECTS.length)
    assert.ok(filterProjects('security').every((p) => p.lane === 'security'))
    assert.ok(filterProjects('tradecraft').every((p) => p.lane === 'tradecraft'))
  })

  it('selectMotionMode respects reduced motion', () => {
    assert.equal(selectMotionMode(true), 'static')
    assert.equal(selectMotionMode(false), 'animated')
  })

  it('experience block is non-empty and named', () => {
    assert.ok(EXPERIENCE.work.org)
    assert.ok(EXPERIENCE.education.school)
    assert.ok(EXPERIENCE.offensive.summary.includes('OSCP') || EXPERIENCE.offensive.summary.length > 20)
  })
})
