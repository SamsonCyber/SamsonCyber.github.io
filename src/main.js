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

// ── Stats ─────────────────────────────────────────────
function buildStats() {
  const grid = document.getElementById('stats-grid')
  if (!grid) return
  grid.innerHTML = SITE.stats
    .map(
      (s) => `
    <div class="stat">
      <span class="stat__value">${escapeHtml(s.value)}</span>
      <span class="stat__label">${escapeHtml(s.label)}</span>
    </div>`
    )
    .join('')
}

// ── Contact strip ───────────────────────────────────────
const CONTACT_ICONS = {
  email: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>`,
  github: `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>`,
  htb: `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 2C7.589 2 4 5.589 4 10c0 2.469 1.125 4.672 2.889 6.124V19a3 3 0 0 0 3 3h4.222a3 3 0 0 0 3-3v-2.876C18.875 14.672 20 12.469 20 10c0-4.411-3.589-8-8-8Zm-2.5 7.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm5 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM8 17h8v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2Z"/></svg>`,
  arch: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><path d="M3 21C3 10.2 6.2 4 12 4s9 6.2 9 17" stroke-width="2"/><path d="M6.5 21C6.5 12.6 8.7 7.8 12 7.8s5.5 4.8 5.5 13.2" stroke-width="1.4" opacity="0.55"/></svg>`,
}

function buildContactStrip() {
  const grid = document.getElementById('contact-grid')
  if (!grid) return
  const cells = [
    {
      icon: CONTACT_ICONS.email,
      label: 'Email',
      html: `<a href="mailto:${SITE.contacts.email}">${SITE.contacts.email}</a>`,
    },
    {
      icon: CONTACT_ICONS.github,
      label: 'GitHub',
      html: `<a href="${SITE.contacts.github}" rel="noopener noreferrer" target="_blank">${SITE.contacts.githubHandle}</a>`,
    },
    {
      icon: CONTACT_ICONS.linkedin,
      label: 'LinkedIn',
      html: `<a href="${SITE.contacts.linkedin}" rel="noopener noreferrer" target="_blank">${SITE.contacts.linkedinHandle}</a>`,
    },
    {
      icon: CONTACT_ICONS.htb,
      label: 'Hack The Box',
      html: `<a href="${SITE.contacts.htb}" rel="noopener noreferrer" target="_blank">${SITE.contacts.htbHandle}</a>`,
    },
    {
      icon: CONTACT_ICONS.arch,
      label: 'Location',
      html: `<span class="contact-cell__value">${SITE.location}</span>`,
    },
  ]
  grid.innerHTML = cells
    .map(
      (c) => `
    <div class="contact-cell">
      <span class="contact-cell__label">${c.icon ? `<span class="contact-cell__icon">${c.icon}</span>` : ''}${c.label}</span>
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
      <p class="resume-item__sub">OSCP in progress · lab and CTF</p>
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
buildStats()
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
