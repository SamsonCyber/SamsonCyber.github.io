/**
 * Pure inertial / spring state for the credential badge.
 * Separated from Three.js so unit tests drive the real shipped math.
 */

/** Rest pose in normalized pointer space (0,0 = hang center). */
export function createBadgeState() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    rotV: 0,
    dragging: false,
    pointerId: null,
    lastPx: 0,
    lastPy: 0,
    lastT: 0,
  }
}

/**
 * @param {ReturnType<typeof createBadgeState>} state
 * @param {number} px normalized -1..1-ish
 * @param {number} py
 * @param {number} [t] performance.now ms
 * @param {number|null} [pointerId]
 */
export function pointerDown(state, px, py, t = 0, pointerId = null) {
  state.dragging = true
  state.pointerId = pointerId
  state.x = px
  state.y = py
  state.vx = 0
  state.vy = 0
  state.lastPx = px
  state.lastPy = py
  state.lastT = t
  state.rot = px * 0.35
  state.rotV = 0
  return state
}

/**
 * @param {ReturnType<typeof createBadgeState>} state
 * @param {number} px
 * @param {number} py
 * @param {number} [t]
 */
export function pointerMove(state, px, py, t = 0) {
  if (!state.dragging) return state
  const dt = Math.max(1, t - state.lastT) / 1000
  const dx = px - state.lastPx
  const dy = py - state.lastPy
  state.vx = dx / dt
  state.vy = dy / dt
  state.x = px
  state.y = py
  state.rot = px * 0.4
  state.rotV = state.vx * 0.08
  state.lastPx = px
  state.lastPy = py
  state.lastT = t
  return state
}

/**
 * @param {ReturnType<typeof createBadgeState>} state
 * @param {number|null} [pointerId]
 */
export function pointerUp(state, pointerId = null) {
  if (pointerId != null && state.pointerId != null && pointerId !== state.pointerId) {
    return state
  }
  state.dragging = false
  state.pointerId = null
  return state
}

/**
 * Integrate spring-back + damped rotation when not dragging.
 * @param {ReturnType<typeof createBadgeState>} state
 * @param {number} dt seconds
 * @param {{ stiffness?: number, damping?: number, maxAbs?: number }} [opts]
 */
export function step(state, dt, opts = {}) {
  const stiffness = opts.stiffness ?? 28
  const damping = opts.damping ?? 8
  const maxAbs = opts.maxAbs ?? 1.4
  const clampedDt = Math.min(0.05, Math.max(0, dt))

  if (state.dragging) {
    state.x = clamp(state.x, -maxAbs, maxAbs)
    state.y = clamp(state.y, -maxAbs, maxAbs)
    return state
  }

  // Spring toward origin
  const ax = -stiffness * state.x - damping * state.vx
  const ay = -stiffness * state.y - damping * state.vy
  state.vx += ax * clampedDt
  state.vy += ay * clampedDt
  state.x += state.vx * clampedDt
  state.y += state.vy * clampedDt

  // Rotation: pendular coupling to x + own damping
  const rotTarget = state.x * 0.45
  const rotA = -stiffness * 0.9 * (state.rot - rotTarget) - damping * 1.1 * state.rotV
  state.rotV += rotA * clampedDt
  state.rot += state.rotV * clampedDt

  state.x = clamp(state.x, -maxAbs, maxAbs)
  state.y = clamp(state.y, -maxAbs, maxAbs)
  return state
}

/**
 * Map badge state to a pose the renderer can apply.
 * @param {ReturnType<typeof createBadgeState>} state
 * @param {{ swingScale?: number, dropScale?: number, rotScale?: number }} [opts]
 */
export function poseFromState(state, opts = {}) {
  const swingScale = opts.swingScale ?? 0.55
  const dropScale = opts.dropScale ?? 0.35
  const rotScale = opts.rotScale ?? 0.55
  return {
    x: state.x * swingScale,
    y: state.y * dropScale,
    rotationZ: state.rot * rotScale,
    dragging: state.dragging,
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}
