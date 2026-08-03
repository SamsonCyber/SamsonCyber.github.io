/**
 * Drives the shipped badge-motion module (spring / inertial path used by Three.js badge).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createBadgeState,
  pointerDown,
  pointerMove,
  pointerUp,
  step,
  poseFromState,
} from '../src/badge-motion.js'

describe('badge motion (shipped module)', () => {
  it('pointer drag moves badge away from rest', () => {
    const s = createBadgeState()
    pointerDown(s, 0, 0, 0, 1)
    pointerMove(s, 0.8, -0.4, 16)
    assert.equal(s.dragging, true)
    assert.ok(s.x > 0.5)
    assert.ok(s.y < 0)
    const pose = poseFromState(s)
    assert.ok(pose.x !== 0 || pose.y !== 0)
    assert.equal(pose.dragging, true)
  })

  it('after release, spring integration returns toward origin', () => {
    const s = createBadgeState()
    pointerDown(s, 0, 0, 0, 1)
    pointerMove(s, 1, 0.5, 20)
    pointerUp(s, 1)
    assert.equal(s.dragging, false)
    const startDist = Math.hypot(s.x, s.y)
    assert.ok(startDist > 0.5)
    for (let i = 0; i < 120; i++) {
      step(s, 1 / 60)
    }
    const endDist = Math.hypot(s.x, s.y)
    assert.ok(
      endDist < startDist * 0.25,
      `expected spring-back: start ${startDist} end ${endDist}`
    )
  })

  it('rotation couples to horizontal swing', () => {
    const s = createBadgeState()
    pointerDown(s, 0.9, 0, 0, 1)
    assert.ok(Math.abs(s.rot) > 0.1)
    pointerUp(s, 1)
    for (let i = 0; i < 40; i++) step(s, 1 / 60)
    const pose = poseFromState(s)
    assert.ok(typeof pose.rotationZ === 'number')
  })

  it('ignores pointerUp for a different pointer id while dragging', () => {
    const s = createBadgeState()
    pointerDown(s, 0.2, 0, 0, 7)
    pointerUp(s, 99)
    assert.equal(s.dragging, true)
    pointerUp(s, 7)
    assert.equal(s.dragging, false)
  })
})
