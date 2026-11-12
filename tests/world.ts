// The machine every test runs on: a disk, a store, a clock, git and the
// engine's answers, all in memory. Nothing here touches a real file.
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

export const HOME = 'C:/home'
export const ROOT = 'C:/proj'
export const LOCAL = `${ROOT}/.claude/settings.local.json`
/** A second project folder, known to Claude Code's own list. */
export const OTHER = 'C:/work/other'
export const OTHER_LOCAL = `${OTHER}/.claude/settings.local.json`

export const DAY = 24 * 60 * 60 * 1000

/**
 * Room for a test that drives the panel. The kit allows a test five seconds;
 * these take about one, and a busy machine or a CI runner can be much slower.
 */
export const SLOW = { timeoutMs: 30_000 }

export const PANE = {
  plugin: 'skills-panel',
  component: 'Pane',
  requestId: 'skills-panel',
  props: {
    title: 'Skills',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

export const LISTING = [
  'The following skills are available for use with the Skill tool:',
  '',
  '- alpha: First skill.',
  '- claude-api: Reference for the API.',
  'TRIGGER — read first.',
  'SKIP when another provider is named.',
  '- cloudflare:wrangler: Run Wrangler.',
  '- gamma',
].join('\n')

export type World = {
  files: Record<string, string>
  /** Folders that exist, besides the ones the files are in. */
  folders: Set<string>
  submitted: { text: string; context: readonly string[] }[]
  opened: string[]
  toasts: string[]
  /** The status line as last set. */
  status: string | undefined
  /** Every command the plugin ran, as its argument list. */
  ran: string[][]
  git: { isInstalled: boolean; isRepo: boolean; isIgnored: boolean; prefix: string }
  /** The folder and the session id the next session start reports. */
  root: string
  sessionId: string
  /** Makes the Skill tool answer with an error. */
  skillFails: boolean
  clock: ReturnType<typeof mock.clock>
}

export type WorldOptions = {
  user?: Record<string, unknown>
  placed?: boolean
  store?: Record<string, unknown>
  /** How many more global skills there are, spread over the topics. */
  many?: number
  /** How many more project folders Claude Code lists. */
  folders?: number
  /** The folder paths in Claude Code's own list (its config file's `projects` keys). */
  projects?: string[]
  /** Skills built into Claude Code, as the engine's own listing reports them. */
  builtins?: string[]
}

/** A machine with two global skills, one project skill, two plugins and two project folders. */
export function world(on: On, settings: WorldOptions = {}): World {
  const files: Record<string, string> = {
    [`${HOME}/.claude/skills/alpha/SKILL.md`]: '---\nname: alpha\ndescription: First skill.\n---\nbody',
    [`${HOME}/.claude/skills/beta/SKILL.md`]:
      "---\nname: beta\ndescription: 'Second: skill.'\ndisable-model-invocation: true\n---\n",
    [`${ROOT}/.claude/skills/gamma/SKILL.md`]: '---\nname: gamma\ndescription: >\n  Project only\n  skill.\n---\n',
    [`${OTHER}/.claude/skills/delta/SKILL.md`]: '---\nname: delta\ndescription: Only in the other folder.\n---\n',
    [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
      version: 2,
      plugins: { 'cloudflare@cloudflare': [{}], 'acme@acme': [{}] },
    }),
  }
  const dirs: Record<string, string[]> = {
    [`${HOME}/.claude/skills`]: ['alpha', 'beta', '.trash', 'synced'],
    [`${ROOT}/.claude/skills`]: ['gamma'],
    [`${OTHER}/.claude/skills`]: ['delta'],
  }
  // As many more global skills as a real machine has, spread over the topics.
  const kinds = ['video', 'research', 'expo', 'obsidian', 'pdf', 'music', 'logo', 'social', 'skill']
  for (let i = 0; i < (settings.many ?? 0); i++) {
    const name = `${kinds[i % kinds.length] ?? 'x'}-helper-${i}`
    dirs[`${HOME}/.claude/skills`]?.push(name)
    files[`${HOME}/.claude/skills/${name}/SKILL.md`] =
      `---\nname: ${name}\ndescription: Helps with ${kinds[i % kinds.length] ?? 'x'} work, number ${i}, in a sentence long enough to be clipped in the list.\n---\n`
  }
  const folders = new Set<string>([HOME, ROOT, OTHER])
  const projects = settings.projects ?? [ROOT, OTHER]
  for (let i = 0; i < (settings.folders ?? 0); i++) {
    const path = `C:/work/p${i}`
    folders.add(path)
    projects.push(path)
    if (i % 3 === 0) files[`${path}/.claude/settings.local.json`] = JSON.stringify({ skillOverrides: { alpha: 'off' } })
  }
  // Claude Code's own config file: only the keys of `projects` are the panel's business.
  files[`${HOME}/.claude.json`] = JSON.stringify({
    userID: 'not for the panel',
    projects: Object.fromEntries(projects.map(path => [path, { history: ['not for the panel'] }])),
  })

  const user = settings.user ?? { enabledPlugins: { 'cloudflare@cloudflare': true, 'acme@acme': false } }
  const w: World = {
    files,
    folders,
    submitted: [],
    opened: [],
    toasts: [],
    status: undefined,
    ran: [],
    git: { isInstalled: true, isRepo: false, isIgnored: false, prefix: '' },
    root: ROOT,
    sessionId: 's1',
    skillFails: false,
    clock: mock.clock(on, { now: 1_000 }),
  }
  const exists = (path: string) =>
    files[path] !== undefined ||
    dirs[path] !== undefined ||
    folders.has(path) ||
    Object.keys(files).some(file => file.startsWith(`${path}/`))

  mock.store(on, settings.store)
  mock.env(on, { USERPROFILE: HOME })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: w.root }))
  on('session.id', () => ({ value: w.sessionId }))
  on('command.register', () => ({ value: { command: 'skills-panel' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__skills-panel__open_panel' } }))
  on('command.list', () => ({
    value: [
      { name: 'alpha', description: 'First skill.', source: 'user' },
      { name: 'beta', description: 'Second: skill.', source: 'user' },
      { name: 'gamma', description: 'Project only skill.', source: 'user' },
      { name: 'cloudflare:wrangler', description: 'Run Wrangler.', source: 'plugin', plugin: 'cloudflare' },
      { name: 'anthropic-skills:pdf', description: 'Read PDFs.', source: 'plugin', plugin: 'anthropic-skills' },
      { name: 'skills-panel', description: 'Open the panel', source: 'plugin', plugin: 'skills-panel' },
    ],
  }))
  const builtins = settings.builtins ?? []
  if (builtins.length > 0) {
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        rateLimits: [],
        context: {
          breakdown: {
            skills: {
              totalSkills: builtins.length,
              includedSkills: builtins.length,
              tokens: builtins.length * 40,
              skillFrontmatter: builtins.map(name => ({ name, source: 'built-in', tokens: 40 })),
            },
          },
        },
      } as never,
    }))
  }
  on('settings.read', (_, e) => {
    const local = parsedOr(files[`${w.root}/.claude/settings.local.json`])
    if (e.source === 'user') return { value: user }
    if (e.source === 'local') return { value: local }
    if (e.source !== undefined) return { value: {} }
    // The merge, as the engine has it: local's keys over the user's.
    return { value: { ...user, ...local } }
  })
  on('fs.list', (_, e) => {
    const names = dirs[norm(e.path)]

    return names === undefined
      ? { deny: 'ENOENT' }
      : { value: names.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.exists', (_, e) => ({ value: exists(norm(e.path)) }))
  on('fs.read', (_, e) => {
    const text = files[norm(e.path)]

    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', (_, e) => {
    files[norm(e.path)] = e.text

    return { value: undefined }
  })
  on('process.run', (_, e) => {
    w.ran.push([...e.argv])
    if (!w.git.isInstalled) return { deny: 'ENOENT: git' }
    const done = (exitCode: number, stdout = '') => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (!w.git.isRepo) return done(128)
    const cwd = norm(e.init?.cwd ?? w.root)
    const excluded = (files[`${cwd}/.git/info/exclude`] ?? '').includes('.claude/settings.local.json')
    if (e.argv[1] === 'check-ignore') return done(w.git.isIgnored || excluded ? 0 : 1)
    if (e.argv[1] === 'rev-parse') return done(0, `${w.git.prefix}\n.git/info/exclude\n`)

    return done(1)
  })
  on('ui.open', (_, e) => {
    w.opened.push(e.id)

    return settings.placed === false
      ? { value: { isPlaced: false as const, reason: 'no-surface' as const } }
      : { value: { isPlaced: true as const } }
  })
  on('ui.status', (_, e) => {
    w.status = e.text

    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.attachment', (_, e) => ({ text: e.text }))
  on('prompt.submit', (_, e) => {
    w.submitted.push({ text: e.text, context: e.context ?? [] })

    return { text: e.text, context: e.context }
  })
  on('tool.call', (_, e) =>
    e.tool === 'Skill' && w.skillFails ? { isError: true as const, result: 'the skill failed' } : { result: {} },
  )

  return w
}

/** The engine hands hooks Windows paths with backslashes; the fake disk keys them with slashes. */
export function norm(path: string): string {
  return path.split(String.fromCharCode(92)).join('/')
}

export function parsedOr(text: string | undefined): Record<string, unknown> {
  try {
    return text === undefined ? {} : (JSON.parse(text) as Record<string, unknown>)
  } catch {
    return {}
  }
}

/** A folder's settings.local.json as it stands (this session's folder when none is named). */
export function local(w: World, file: string = LOCAL): Record<string, unknown> {
  return JSON.parse(w.files[file] ?? '{}') as Record<string, unknown>
}

type Finds = { find: (query: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }

/** The label a switch or a button shows: `On`, `Off`, `Some on`, `Sure? Delete`. */
export async function shows(ui: Finds, key: string): Promise<unknown> {
  return (await ui.find({ key }))?.props['label']
}

/** Starts a session in the world's folder and opens the loaded panel on the desktop. */
export async function openPanel($: Engine) {
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })

  return ui
}
