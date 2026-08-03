import './style.css'
import {
  SITE,
  PROJECTS,
  EXPERIENCE,
  validateContent,
  filterProjects,
} from './content.js'
import { startFlowField } from './motion.js'

// Boot-time content guard (surfaced in console if model drifts)
const check = validateContent()
if (!check.ok) {
  console.error('[portfolio] content validation failed:', check.errors)
}

// ── Motion background ───────────────────────────────────
const canvas = document.getElementById('bg')
let motionHandle = null
if (canvas) {
  motionHandle = startFlowField(canvas)
  document.documentElement.dataset.motion = motionHandle.mode
}

// ── Hero ────────────────────────────────────────────────
const ledeEl = document.getElementById('hero-lede')
if (ledeEl) ledeEl.textContent = SITE.lede

const roleEl = document.getElementById('hero-role')
if (roleEl) roleEl.textContent = SITE.roleLine

// ── Contact strip ───────────────────────────────────────
function buildContactStrip() {
  const grid = document.getElementById('contact-grid')
  if (!grid) return
  const cells = [
    {
      label: 'Email',
      html: `<a href="mailto:${SITE.contacts.email}">${SITE.contacts.email}</a>`,
    },
    {
      label: 'GitHub',
      html: `<a href="${SITE.contacts.github}" rel="noopener noreferrer" target="_blank">${SITE.contacts.githubLabel}</a>`,
    },
    {
      label: 'LinkedIn',
      html: `<a href="${SITE.contacts.linkedin}" rel="noopener noreferrer" target="_blank">${SITE.contacts.linkedinLabel}</a>`,
    },
    {
      label: 'Hack The Box',
      html: `<a href="${SITE.contacts.htb}" rel="noopener noreferrer" target="_blank">${SITE.contacts.htbLabel}</a>`,
    },
    {
      label: 'Location',
      html: `<span class="contact-cell__value">${SITE.location}</span>`,
    },
  ]
  grid.innerHTML = cells
    .map(
      (c) => `
    <div class="contact-cell">
      <span class="contact-cell__label">${c.label}</span>
      ${c.html}
    </div>`
    )
    .join('')
}

// ── Projects ────────────────────────────────────────────
function projectItemHTML(p) {
  const name =
    p.href != null
      ? `<a class="project__name" href="${p.href}" rel="noopener noreferrer" target="_blank">${escapeHtml(p.name)}</a>`
      : `<span class="project__name">${escapeHtml(p.name)}</span>`

  const links = []
  if (p.href) {
    links.push(
      `<a href="${p.href}" rel="noopener noreferrer" target="_blank">Repository</a>`
    )
  }
  if (p.live) {
    links.push(
      `<a href="${p.live}" rel="noopener noreferrer" target="_blank">Live</a>`
    )
  }

  return `
    <li class="project reveal" data-lane="${p.lane}" data-id="${p.id}">
      <div class="project__meta">${escapeHtml(p.tag)}</div>
      <div>
        ${name}
        <p class="project__blurb">${escapeHtml(p.blurb)}</p>
        ${p.note ? `<p class="project__note">${escapeHtml(p.note)}</p>` : ''}
        ${p.proof ? `<p class="project__proof">${escapeHtml(p.proof)}</p>` : ''}
      </div>
      <div class="project__links">${links.join('')}</div>
    </li>`
}

function renderProjects(lane = 'all') {
  const list = document.getElementById('project-list')
  if (!list) return
  const items = filterProjects(lane)
  list.innerHTML = items.map(projectItemHTML).join('')
  observeReveals(list.querySelectorAll('.reveal'))
  const live = document.getElementById('project-live')
  if (live) {
    const label =
      lane === 'all' ? 'All lanes' : lane.charAt(0).toUpperCase() + lane.slice(1)
    live.textContent = `${items.length} project${items.length === 1 ? '' : 's'} - ${label}`
  }
}

function wireFilters() {
  const buttons = document.querySelectorAll('.filter-btn')
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const lane = btn.getAttribute('data-lane') || 'all'
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)))
      renderProjects(lane)
    })
  })
}

// ── Approach ────────────────────────────────────────────
function buildApproach() {
  const grid = document.getElementById('approach-grid')
  if (!grid) return
  grid.innerHTML = SITE.howIWork
    .map(
      (item) => `
    <article class="approach-card reveal">
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.body)}</p>
    </article>`
    )
    .join('')
  observeReveals(grid.querySelectorAll('.reveal'))
}

// ── Background / resume ─────────────────────────────────
function buildResume() {
  const root = document.getElementById('resume-block')
  if (!root) return
  const e = EXPERIENCE
  root.innerHTML = `
    <article class="resume-item reveal">
      <h3>${escapeHtml(e.work.org)}</h3>
      <p class="resume-item__sub">${escapeHtml(e.work.title)} · ${escapeHtml(e.work.years)}</p>
      <p>${escapeHtml(e.work.summary)}</p>
    </article>
    <article class="resume-item reveal">
      <h3>${escapeHtml(e.offensive.title)}</h3>
      <p class="resume-item__sub">OSCP · lab and CTF</p>
      <p>${escapeHtml(e.offensive.summary)}</p>
    </article>
    <article class="resume-item reveal">
      <h3>${escapeHtml(e.education.degree)}</h3>
      <p class="resume-item__sub">${escapeHtml(e.education.school)} · ${escapeHtml(e.education.year)}</p>
      <p>${escapeHtml(e.education.summary)}</p>
    </article>`
  observeReveals(root.querySelectorAll('.reveal'))
}

// ── External links ──────────────────────────────────────
function buildLinks() {
  const row = document.getElementById('link-row')
  if (!row) return
  row.innerHTML = SITE.external
    .map((l) => {
      const external = l.href.startsWith('http')
      const attrs = external
        ? ' rel="noopener noreferrer" target="_blank"'
        : ''
      return `<li><a href="${l.href}"${attrs}>${escapeHtml(l.label)}</a></li>`
    })
    .join('')
}

// ── Utils ───────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

let revealObserver = null
function observeReveals(nodes) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    nodes.forEach((n) => n.classList.add('is-in'))
    return
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          if (ent.isIntersecting) {
            ent.target.classList.add('is-in')
            revealObserver.unobserve(ent.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    )
  }
  nodes.forEach((n, i) => {
    n.style.setProperty('--stagger', `${Math.min(i, 8) * 0.045}s`)
    revealObserver.observe(n)
  })
}

// ── Init ────────────────────────────────────────────────
buildContactStrip()
renderProjects('all')
wireFilters()
buildApproach()
buildResume()
buildLinks()

// Export for tests / debugging
export { SITE, PROJECTS, validateContent, filterProjects }

// Cleanup on hot reload
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    motionHandle?.destroy()
  })
}
