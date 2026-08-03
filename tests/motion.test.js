import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { selectMotionMode } from '../src/content.js'

describe('motion gate', () => {
  it('static mode when prefers-reduced-motion', () => {
    assert.equal(selectMotionMode(true), 'static')
  })

  it('animated mode when motion is allowed', () => {
    assert.equal(selectMotionMode(false), 'animated')
  })
})
