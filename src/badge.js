/**
 * Three.js access-credential badge with lanyard-class inertial drag.
 * Professional pass card (hiring / security), not a toy UI chrome stack.
 */

import * as THREE from 'three'
import {
  createBadgeState,
  pointerDown,
  pointerMove,
  pointerUp,
  step,
  poseFromState,
} from './badge-motion.js'
import { selectMotionMode } from './content.js'

/**
 * @param {HTMLElement} mount
 * @param {{ prefersReducedMotion?: boolean }} [opts]
 */
export function startCredentialBadge(mount, opts = {}) {
  const reduced =
    opts.prefersReducedMotion ??
    (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const mode = selectMotionMode(!!reduced)

  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  mount.appendChild(canvas)

  if (mode === 'static') {
    paintStaticBadge(canvas, mount)
    return {
      mode: 'static',
      destroy() {
        canvas.remove()
      },
    }
  }

  let width = mount.clientWidth || 320
  let height = mount.clientHeight || 300
  if (height < 200) height = 280

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 50)
  camera.position.set(0, 0.15, 4.2)

  const light = new THREE.DirectionalLight(0xffffff, 1.15)
  light.position.set(2.2, 3.5, 4)
  scene.add(light)
  scene.add(new THREE.AmbientLight(0xb0c4de, 0.55))

  const root = new THREE.Group()
  scene.add(root)

  // Cord / strap
  const strapGeo = new THREE.CylinderGeometry(0.018, 0.018, 1.35, 12)
  const strapMat = new THREE.MeshStandardMaterial({
    color: 0x2a3340,
    roughness: 0.75,
    metalness: 0.15,
  })
  const strap = new THREE.Mesh(strapGeo, strapMat)
  strap.position.y = 1.15
  root.add(strap)

  // Metal clip
  const clipGeo = new THREE.BoxGeometry(0.22, 0.08, 0.06)
  const clipMat = new THREE.MeshStandardMaterial({
    color: 0x8a93a0,
    roughness: 0.35,
    metalness: 0.85,
  })
  const clip = new THREE.Mesh(clipGeo, clipMat)
  clip.position.y = 0.48
  root.add(clip)

  // Badge body
  const cardGeo = new THREE.BoxGeometry(1.35, 1.9, 0.06)
  const faceTex = makeBadgeTexture()
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex,
    roughness: 0.55,
    metalness: 0.08,
  })
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x1a222c,
    roughness: 0.6,
    metalness: 0.2,
  })
  const card = new THREE.Mesh(cardGeo, [
    edgeMat,
    edgeMat,
    edgeMat,
    edgeMat,
    faceMat,
    edgeMat,
  ])
  card.position.y = -0.55
  root.add(card)

  // Soft floor shadow disc
  const shadowGeo = new THREE.CircleGeometry(0.85, 32)
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.18,
  })
  const shadow = new THREE.Mesh(shadowGeo, shadowMat)
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -1.65
  scene.add(shadow)

  const state = createBadgeState()
  let raf = 0
  let lastT = performance.now()
  let disposed = false

  function normPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect()
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1)
    return { px: nx * 1.1, py: ny * 1.1 }
  }

  function onPointerDown(e) {
    canvas.setPointerCapture?.(e.pointerId)
    const { px, py } = normPointer(e.clientX, e.clientY)
    pointerDown(state, px, py, performance.now(), e.pointerId)
  }

  function onPointerMove(e) {
    if (!state.dragging) return
    const { px, py } = normPointer(e.clientX, e.clientY)
    pointerMove(state, px, py, performance.now())
  }

  function onPointerUp(e) {
    pointerUp(state, e.pointerId)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerUp)

  function resize() {
    width = mount.clientWidth || 320
    height = Math.max(mount.clientHeight || 280, 240)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }

  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => resize())
      : null
  ro?.observe(mount)
  window.addEventListener('resize', resize)

  function frame(now) {
    if (disposed) return
    const dt = Math.min(0.05, (now - lastT) / 1000)
    lastT = now
    step(state, dt)
    const pose = poseFromState(state)
    root.position.x = pose.x
    root.position.y = pose.y
    root.rotation.z = pose.rotationZ
    // slight 3D tilt while swinging
    root.rotation.x = -pose.y * 0.12
    root.rotation.y = pose.x * 0.18
    shadow.position.x = pose.x * 0.35
    shadow.material.opacity = 0.12 + Math.min(0.12, Math.hypot(pose.x, pose.y) * 0.08)
    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }

  resize()
  raf = requestAnimationFrame(frame)

  return {
    mode: 'animated',
    destroy() {
      disposed = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerUp)
      window.removeEventListener('resize', resize)
      ro?.disconnect()
      cardGeo.dispose()
      strapGeo.dispose()
      clipGeo.dispose()
      shadowGeo.dispose()
      faceTex.dispose()
      faceMat.dispose()
      edgeMat.dispose()
      strapMat.dispose()
      clipMat.dispose()
      shadowMat.dispose()
      renderer.dispose()
      canvas.remove()
    },
  }
}

function makeBadgeTexture() {
  const size = 512
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  // credential face
  ctx.fillStyle = '#121820'
  ctx.fillRect(0, 0, size, size)
  // teal header band
  ctx.fillStyle = '#0f766e'
  ctx.fillRect(0, 0, size, 88)
  ctx.fillStyle = '#f0fdfa'
  ctx.font = '600 28px system-ui, sans-serif'
  ctx.fillText('ACCESS CREDENTIAL', 36, 56)

  ctx.fillStyle = '#e8ecf1'
  ctx.font = '650 42px system-ui, sans-serif'
  ctx.fillText('Samson Laird', 36, 170)

  ctx.fillStyle = '#9aa3b2'
  ctx.font = '500 26px system-ui, sans-serif'
  ctx.fillText('LLM / Agent Security', 36, 220)
  ctx.fillText('OSCP  ·  St. Louis', 36, 260)

  ctx.strokeStyle = 'rgba(94, 234, 212, 0.45)'
  ctx.lineWidth = 2
  ctx.strokeRect(28, 300, size - 56, 140)

  ctx.fillStyle = '#5eead4'
  ctx.font = '600 22px ui-monospace, monospace'
  ctx.fillText('SCOPE', 48, 340)
  ctx.fillStyle = '#c8d0dc'
  ctx.font = '500 22px system-ui, sans-serif'
  ctx.fillText('Lab · CTF · written auth', 48, 378)
  ctx.fillText('In-scope bounty only', 48, 412)

  ctx.fillStyle = '#5c6570'
  ctx.font = '500 18px ui-monospace, monospace'
  ctx.fillText('ID · SAMSON-ENG', 36, 480)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function paintStaticBadge(canvas, mount) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = mount.clientWidth || 320
  const h = Math.max(mount.clientHeight || 280, 240)
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  // simple flat credential card
  const cw = Math.min(200, w * 0.55)
  const ch = cw * 1.35
  const x = (w - cw) / 2
  const y = (h - ch) / 2 + 10
  ctx.fillStyle = '#2a3340'
  ctx.fillRect(w / 2 - 2, 16, 4, y - 10)
  ctx.fillStyle = '#121820'
  ctx.strokeStyle = 'rgba(94, 234, 212, 0.35)'
  ctx.lineWidth = 1.5
  roundRect(ctx, x, y, cw, ch, 8)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#0f766e'
  ctx.fillRect(x, y, cw, 28)
  ctx.fillStyle = '#f0fdfa'
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.fillText('ACCESS CREDENTIAL', x + 12, y + 18)
  ctx.fillStyle = '#e8ecf1'
  ctx.font = '650 16px system-ui, sans-serif'
  ctx.fillText('Samson Laird', x + 12, y + 56)
  ctx.fillStyle = '#9aa3b2'
  ctx.font = '500 11px system-ui, sans-serif'
  ctx.fillText('LLM Security · OSCP', x + 12, y + 78)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
