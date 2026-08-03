/**
 * Contour / topo field — layered sine ridges that warp under the pointer.
 * Custom motion for this site. Not Raven gold trails, not stock particles.
 */

import { selectMotionMode } from './content.js'

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ prefersReducedMotion?: boolean }} [opts]
 */
export function startFlowField(canvas, opts = {}) {
  const reduced =
    opts.prefersReducedMotion ??
    (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const mode = selectMotionMode(!!reduced)
  const ctx = canvas.getContext('2d')
  if (!ctx) return { destroy() {}, mode: 'static' }

  const voidBg = '#0e1014'

  if (mode === 'static') {
    const paint = () => {
      const dpr = window.devicePixelRatio || 1
      const W = window.innerWidth
      const H = window.innerHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = W + 'px'
      canvas.style.height = H + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = voidBg
      ctx.fillRect(0, 0, W, H)
      // static contour sample
      ctx.strokeStyle = 'rgba(232,230,225,0.05)'
      ctx.lineWidth = 1
      for (let y = 40; y < H; y += 36) {
        ctx.beginPath()
        for (let x = 0; x <= W; x += 8) {
          const yy = y + Math.sin(x * 0.012 + y * 0.02) * 10
          if (x === 0) ctx.moveTo(x, yy)
          else ctx.lineTo(x, yy)
        }
        ctx.stroke()
      }
    }
    paint()
    window.addEventListener('resize', paint)
    return {
      mode: 'static',
      destroy() {
        window.removeEventListener('resize', paint)
      },
    }
  }

  let W = 0
  let H = 0
  let raf = 0
  let time = 0
  const pointer = { x: 0.5, y: 0.5, active: false }
  const smooth = { x: 0.5, y: 0.5 }

  function resize() {
    const dpr = window.devicePixelRatio || 1
    W = window.innerWidth
    H = window.innerHeight
    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = W + 'px'
    canvas.style.height = H + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function onMove(e) {
    pointer.x = e.clientX / Math.max(1, W)
    pointer.y = e.clientY / Math.max(1, H)
    pointer.active = true
  }
  function onLeave() {
    pointer.active = false
  }

  function draw() {
    ctx.fillStyle = voidBg
    ctx.fillRect(0, 0, W, H)

    time += 0.008
    smooth.x += (pointer.x - smooth.x) * 0.05
    smooth.y += (pointer.y - smooth.y) * 0.05

    const mx = smooth.x * W
    const my = smooth.y * H

    // faint vertical measure ticks (blueprint)
    ctx.strokeStyle = 'rgba(232,230,225,0.03)'
    ctx.lineWidth = 1
    for (let x = 48; x < W; x += 80) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
      ctx.stroke()
    }

    const spacing = Math.max(28, Math.floor(H / 28))
    const step = 6

    for (let row = 0; row < H + spacing; row += spacing) {
      const band = row / H
      // alternate bone / coral at low alpha (no green)
      let stroke
      if (row % (spacing * 5) === 0) {
        stroke = 'rgba(255,92,57,0.12)'
      } else if (row % (spacing * 3) === 0) {
        stroke = 'rgba(255,92,57,0.06)'
      } else {
        stroke = `rgba(232,230,225,${0.035 + band * 0.025})`
      }
      ctx.strokeStyle = stroke
      ctx.lineWidth = row % (spacing * 5) === 0 ? 1.25 : 1
      ctx.beginPath()
      for (let x = 0; x <= W; x += step) {
        let y =
          row +
          Math.sin(x * 0.008 + time + row * 0.015) * 11 +
          Math.sin(x * 0.021 - time * 0.7 + row * 0.03) * 6

        // pointer warp
        const dx = x - mx
        const dy = y - my
        const dist = Math.hypot(dx, dy)
        if (dist < 220) {
          const f = (1 - dist / 220) ** 2
          y -= f * 22 * (pointer.active ? 1 : 0.35)
        }

        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // soft cursor ring
    if (pointer.active) {
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 180)
      g.addColorStop(0, 'rgba(255,92,57,0.09)')
      g.addColorStop(0.45, 'rgba(255,92,57,0.03)')
      g.addColorStop(1, 'rgba(255,92,57,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }

    raf = requestAnimationFrame(draw)
  }

  function onResize() {
    resize()
  }

  resize()
  draw()
  window.addEventListener('resize', onResize)
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerleave', onLeave)

  return {
    mode: 'animated',
    destroy() {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    },
  }
}
