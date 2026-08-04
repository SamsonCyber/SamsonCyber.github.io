/**
 * Portfolio content model — single source of truth for DOM render + tests.
 * Do not invent employers, metrics, or repos. Links must be real public URLs.
 */

export const SITE = {
  name: 'Samson Laird',
  titleWord: 'SAMSON',
  roleLine: 'LLM / agent security & agentic trading · OSCP in progress',
  location: 'St. Louis, Missouri',
  lede:
    'I build detectors, red-team harnesses, and control planes for tool-using agents, and agentic systems that trade under the same kind of gates. Mechanism first. Measure, then claim.',
  stats: [
    { value: '101', label: 'CTF writeups' },
    { value: '8', label: 'projects' },
    { value: '324', label: 'injection techniques cataloged' },
    { value: '100+', label: 'machines rooted' },
  ],
  howIWork: [
    {
      title: 'Mechanism first',
      body: 'Name the failure mode, not only the meme payload. Catalog techniques by how they slip past training and filters.',
    },
    {
      title: 'Measure, then claim',
      body: 'Re-fire, bounds, honest gaps. One lucky hit is not a result. Flagships ship a single offline repro command.',
    },
    {
      title: 'Scope gates',
      body: 'SSRF and engagement receipts on harness fire paths. Authorized targets only: lab, CTF, written engagement, in-scope bounty.',
    },
  ],
  contacts: {
    email: 'shotgunsamm6@gmail.com',
    github: 'https://github.com/SamsonCyber',
    githubLabel: 'github.com/SamsonCyber',
    linkedin: 'https://www.linkedin.com/in/sam-laird-50446021b/',
    linkedinLabel: 'linkedin.com/in/sam-laird-50446021b',
    htb: 'https://profile.hackthebox.com/profile/019c8240-5890-72f0-8ff8-e8b4e1792092',
    htbLabel: 'Samsonnn',
  },
  external: [
    { label: 'GitHub', href: 'https://github.com/SamsonCyber' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/sam-laird-50446021b/' },
    {
      label: 'HTB',
      href: 'https://profile.hackthebox.com/profile/019c8240-5890-72f0-8ff8-e8b4e1792092',
    },
    { label: 'Field guide (live)', href: 'https://samsoncyber.github.io/llm-injection-field-guide/' },
    { label: 'CTF writeups', href: './writeups/' },
  ],
}

/** Featured projects — public SamsonCyber + established personal platforms. */
export const PROJECTS = [
  {
    id: 'garbleworks',
    name: 'Garbleworks',
    lane: 'security',
    tag: 'LLM red team',
    blurb:
      'Authorized red-team harness: composable attack recipes, evolve/search, scoped fire, MCP + TUI. SSRF and engagement scope gates on every fire path.',
    href: 'https://github.com/SamsonCyber/garbleworks',
    proof: 'python scripts/repro.py → REPRO_OK',
  },
  {
    id: 'stegoff',
    name: 'StegOFF',
    lane: 'security',
    tag: 'Defense library',
    blurb:
      'Pre-ingest gate: scan text and files for stego and prompt injection before they hit an LLM. check / clean API and CLI.',
    href: 'https://github.com/SamsonCyber/stegoff',
    proof: 'Offline pytest suite · REPRO_OK',
  },
  {
    id: 'field-guide',
    name: 'LLM Injection Field Guide',
    lane: 'security',
    tag: 'Reference',
    blurb:
      'Dark Promptery: 324 techniques across 20 categories, defense fields, crosswalked to OWASP LLM Top 10, MITRE ATLAS, NIST, and CWE.',
    href: 'https://github.com/SamsonCyber/llm-injection-field-guide',
    live: 'https://samsoncyber.github.io/llm-injection-field-guide/',
    proof: 'Live catalog · zero-build HTML',
  },
  {
    id: 'agentic-dm-gateway',
    name: 'Agentic DM Gateway',
    lane: 'security',
    tag: 'Control plane',
    blurb:
      'Security control plane for LLM agents over private DMs: allowlist, PIN, kill switch, rate limits, injection heuristics, secret redaction, audit log.',
    href: 'https://github.com/SamsonCyber/agentic-dm-gateway',
    proof: '12 security unit tests · REPRO_OK',
  },
  {
    id: 'agent-canary',
    name: 'Agent Canary',
    lane: 'security',
    tag: 'Tripwires',
    blurb:
      'Tripwire detection for autonomous agents: file honeypots, MCP tool traps, API decoys, forensic alerts.',
    href: 'https://github.com/SamsonCyber/agent-canary',
    proof: 'Public package + tests',
  },
  {
    id: 'agent-trap-lab',
    name: 'Agent Trap Lab',
    lane: 'security',
    tag: 'Eval lab',
    blurb:
      'AI web-browsing agent trap lab: adversarial pages, StegOFF defense matrix, Ollama evaluation harness. Publishes defended vs gap verdicts.',
    href: 'https://github.com/SamsonCyber/agent-trap-lab',
    proof: 'Detector unit tests offline',
  },
  {
    id: 'cantina',
    name: 'Cantina',
    lane: 'tradecraft',
    tag: 'OSCP recon',
    blurb:
      'OSCP-legal network recon orchestrator: port scan, service enum plugins, multi-target timeouts. Enumeration only. No exploit auto-run.',
    href: 'https://github.com/SamsonCyber/cantina',
    proof: 'pytest suite',
  },
  {
    id: 'raven',
    name: 'Raven',
    lane: 'trading',
    tag: 'Agentic trading',
    blurb:
      'Quant + agent swarm platform: microstructure signals, walk-forward validation, multi-agent market simulation. Same control-plane discipline as the security stack: kill switches, audit, measurement.',
    href: null,
    note: 'Invite / lab platform. Not a public product repo.',
    proof: 'Private lab; control-plane ideas mirror agentic-dm-gateway (kill, audit, gates)',
  },
]

export const EXPERIENCE = {
  work: {
    org: 'Environmental Restoration LLC',
    title: 'IT operations',
    years: '2022-present',
    summary:
      'Two-person IT team, ~300 users nationwide, CMMC Level 2 environment. Own pieces of Device Control, BitLocker architecture, Autopilot modernization, and control-mapped policy work (NIST 800-171).',
  },
  education: {
    school: 'Maryville University',
    degree: 'B.S. Cybersecurity',
    year: '2025',
    summary:
      'Three tracks: risk and compliance, offensive methods, and defensive operations. Graduated 2025.',
  },
  offensive: {
    title: 'Offensive security',
    summary:
      'OSCP in progress. 100+ machines rooted across HTB, Proving Grounds, TryHackMe, and VulnHub. Active Directory chains, Linux and Windows privilege escalation. Writeups published for retired boxes.',
  },
}

/** Placeholder / dead link patterns tests must reject. */
export const FORBIDDEN_HREF_SNIPPETS = [
  'example.com',
  'placeholder',
  'TODO',
  'your-email',
  'localhost:3',
]

/**
 * @param {string | null | undefined} href
 * @returns {boolean}
 */
export function isValidPublicHref(href) {
  if (href == null || href === '') return true // internal-only allowed when noted
  if (typeof href !== 'string') return false
  const t = href.trim()
  if (!t) return false
  for (const bad of FORBIDDEN_HREF_SNIPPETS) {
    if (t.toLowerCase().includes(bad.toLowerCase())) return false
  }
  if (t.startsWith('./') || t.startsWith('/')) return true
  if (t.startsWith('mailto:')) {
    return t.includes('@') && !t.includes('example.com')
  }
  try {
    const u = new URL(t)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Validate the content model for tests and boot-time asserts.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateContent() {
  const errors = []
  const c = SITE.contacts
  if (!c.email || !c.email.includes('@')) errors.push('contacts.email missing or invalid')
  if (!isValidPublicHref(c.github)) errors.push('contacts.github invalid')
  if (!isValidPublicHref(c.linkedin)) errors.push('contacts.linkedin invalid')
  if (!c.htb || !isValidPublicHref(c.htb)) errors.push('contacts.htb invalid')
  if (!SITE.titleWord || SITE.titleWord !== 'SAMSON') errors.push('titleWord must be SAMSON')
  if (!SITE.location) errors.push('location required')

  const featured = PROJECTS.filter((p) => p.lane === 'security' || p.lane === 'trading')
  if (featured.length < 4) errors.push('need at least 4 security/trading projects')

  for (const p of PROJECTS) {
    if (!p.name || !p.blurb) errors.push(`project ${p.id}: name/blurb required`)
    if (p.href != null && !isValidPublicHref(p.href)) {
      errors.push(`project ${p.id}: bad href ${p.href}`)
    }
    if (p.live != null && !isValidPublicHref(p.live)) {
      errors.push(`project ${p.id}: bad live ${p.live}`)
    }
    if (p.href == null && !p.note) {
      errors.push(`project ${p.id}: internal project needs note`)
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * @param {'all' | 'security' | 'trading' | 'tradecraft'} lane
 */
export function filterProjects(lane) {
  if (lane === 'all') return PROJECTS.slice()
  return PROJECTS.filter((p) => p.lane === lane)
}

/**
 * @param {boolean} prefersReducedMotion
 * @returns {'static' | 'animated'}
 */
export function selectMotionMode(prefersReducedMotion) {
  return prefersReducedMotion ? 'static' : 'animated'
}
