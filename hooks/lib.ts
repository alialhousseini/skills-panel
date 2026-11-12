// Pure helpers: no `$`, so the tests can call them directly.
import type { Level, Op, PendingNote, SkillRow } from '../types'

export type LayerSource = 'user' | 'project' | 'local' | 'flag' | 'policy'

/** One settings source, lowest precedence first in a list. */
export type Layer = { source: LayerSource; settings: Readonly<Record<string, unknown>> }

export type FileOp = Exclude<Op, { kind: 'session' }>

export const LAYER_NAMES: Record<LayerSource, string> = {
  user: 'your user settings',
  project: "the project's shared settings",
  local: 'this project',
  flag: 'a --settings file',
  policy: 'managed policy',
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------- paths

/** Joins path parts with the separator the first part uses. */
export function join(...parts: string[]): string {
  const first = parts[0] ?? ''
  const sep = first.includes('\\') && !first.includes('/') ? '\\' : '/'

  return parts
    .filter(part => part !== '')
    .map((part, i) =>
      i === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, ''),
    )
    .join(sep)
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)

  return parts[parts.length - 1] ?? path
}

export function samePath(a: string, b: string): boolean {
  return a !== '' && b !== '' && folderKey(a) === folderKey(b)
}

/** A folder's name in the panel's store: lowercased, forward slashes, no trailing slash. */
export function folderKey(path: string): string {
  const key = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

  return key === '' && path !== '' ? '/' : key
}

/** The folder a path sits in, or '' for a root. */
export function parentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))

  return cut <= 0 ? '' : trimmed.slice(0, cut)
}

// ---------------------------------------------------------------- SKILL.md

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Reads the top-level keys of a SKILL.md frontmatter block, as plain strings. */
export function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(stripBom(text))
  if (!match) return {}

  const lines = (match[1] ?? '').split(/\r?\n/)
  const out: Record<string, string> = {}

  for (let i = 0; i < lines.length; i++) {
    const keyMatch = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i] ?? '')
    if (!keyMatch) continue

    const key = keyMatch[1] ?? ''
    let value = (keyMatch[2] ?? '').trim()
    const more: string[] = []
    while (i + 1 < lines.length && /^([ \t]+\S|[ \t]*$)/.test(lines[i + 1] ?? '')) {
      more.push((lines[i + 1] ?? '').trim())
      i++
    }

    if (/^[|>][+-]?$/.test(value)) {
      value = value.startsWith('>') ? more.join(' ') : more.join('\n')
    } else {
      value = unquote([value, ...more].join(' ').trim())
    }
    out[key] = value.replace(/\s+/g, ' ').trim()
  }

  return out
}

function unquote(value: string): string {
  const first = value[0]
  if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
    const inner = value.slice(1, -1)

    return first === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"')
  }

  return value
}

// ---------------------------------------------------------------- settings files

export function parseSettings(text: string | null): { value: Record<string, unknown> } | { error: string } {
  if (text === null || text.trim() === '') return { value: {} }

  try {
    const value: unknown = JSON.parse(stripBom(text))

    return isRecord(value) ? { value } : { error: 'is not a JSON object' }
  } catch {
    return { error: 'is not valid JSON' }
  }
}

export function stringifySettings(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** The deny rule the panel writes for a plugin skill. */
export function skillRule(id: string): string {
  return `Skill(${id})`
}

/** Whether one deny rule blocks the skill `id` (exact, `name *`, `skill:name`, bare `Skill`). */
export function denies(rule: string, id: string): boolean {
  if (/^\s*Skill\s*$/.test(rule)) return true

  const match = /^\s*Skill\s*\(\s*(.*?)\s*\)\s*$/.exec(rule)
  if (!match) return false

  const arg = (match[1] ?? '').replace(/^\//, '')
  if (arg === id || arg === `skill:${id}`) return true

  const prefix = /^(.*?)(?: \*|:\*)$/.exec(arg)?.[1]

  return prefix !== undefined && prefix !== '' && (id === prefix || id.startsWith(`${prefix}:`))
}

function denyList(settings: Readonly<Record<string, unknown>>): string[] {
  const permissions = settings['permissions']
  const deny = isRecord(permissions) ? permissions['deny'] : undefined

  return Array.isArray(deny) ? deny.filter((rule): rule is string => typeof rule === 'string') : []
}

/** Every deny rule of every layer. */
export function allDenyRules(layers: readonly Layer[]): string[] {
  return layers.flatMap(layer => denyList(layer.settings))
}

/** The layers whose deny rules block `id`. */
export function denySources(layers: readonly Layer[], id: string): LayerSource[] {
  return layers.filter(layer => denyList(layer.settings).some(rule => denies(rule, id))).map(layer => layer.source)
}

/** The `skillOverrides` value in force for `id`, and the layer it comes from. */
export function overrideOf(layers: readonly Layer[], id: string): { value?: string; source?: LayerSource } {
  let found: { value?: string; source?: LayerSource } = {}
  for (const layer of layers) {
    const overrides = layer.settings['skillOverrides']
    const value = isRecord(overrides) ? overrides[id] : undefined
    if (typeof value === 'string') found = { value, source: layer.source }
  }

  return found
}

/** The `enabledPlugins` value in force for a plugin id, and its layer. */
export function enabledOf(layers: readonly Layer[], pluginId: string): { value?: boolean; source?: LayerSource } {
  let found: { value?: boolean; source?: LayerSource } = {}
  for (const layer of layers) {
    const enabled = layer.settings['enabledPlugins']
    const value = isRecord(enabled) ? enabled[pluginId] : undefined
    if (typeof value === 'boolean') found = { value, source: layer.source }
  }

  return found
}

/** Plugin and app skills are switched with deny rules: `skillOverrides` skips them. */
export function usesDeny(row: Pick<SkillRow, 'kind' | 'id'>): boolean {
  return row.kind === 'plugin' || row.kind === 'app' || (row.kind === 'other' && row.id.includes(':'))
}

// ---------------------------------------------------------------- levels (skillOverrides values)

export const LEVELS: readonly Level[] = ['on', 'name-only', 'user-invocable-only', 'off']

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
}

/** A `skillOverrides` value as a level: absent or unknown reads as on. */
export function levelOf(value: string | undefined): Level {
  return isLevel(value) ? value : 'on'
}

/** What each level means, as the details dropdown lists it. */
export const LEVEL_LABELS: Record<Level, string> = {
  on: 'On: Claude sees its name and description',
  'name-only': 'Name only: Claude sees just the name (saves context)',
  'user-invocable-only': 'Only you: runs when you type /name',
  off: 'Off: hidden from Claude and from the / menu',
}

/** The short tag a row shows for a level that is not plain on or off. */
export const LEVEL_TAGS: Record<Level, string | null> = {
  on: null,
  'name-only': 'name only',
  'user-invocable-only': 'only by /name',
  off: null,
}

/**
 * The one local op that makes `row` read `level` for this project. A level the
 * lower layers already give is reached by removing the local key, so the file
 * keeps only what this project changes.
 */
export function levelOp(row: Pick<SkillRow, 'kind' | 'id'>, level: Level, lower: readonly Layer[]): FileOp {
  if (usesDeny(row)) return { kind: 'deny', id: row.id, before: false, after: level === 'off' }
  const inherited = levelOf(overrideOf(lower, row.id).value)

  return { kind: 'override', id: row.id, before: null, after: level === inherited ? null : level }
}

/** Whether Claude may call a skill at this level (it is in Claude's list). */
export function isCallable(level: Level): boolean {
  return level === 'on' || level === 'name-only'
}

/**
 * Applies file ops to a copy of a settings object. Each op sets one key to its
 * `after`; the result lists the ops that changed something, with the `before`
 * they found, which is what Undo puts back.
 */
export function applyOps(
  settings: Readonly<Record<string, unknown>>,
  ops: readonly FileOp[],
): { updated: Record<string, unknown>; applied: FileOp[] } {
  const updated = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>
  const applied: FileOp[] = []

  for (const op of ops) {
    if (op.kind === 'override') {
      if (updated['skillOverrides'] !== undefined && !isRecord(updated['skillOverrides'])) {
        throw new Error('skillOverrides is not an object')
      }
      const overrides = isRecord(updated['skillOverrides']) ? updated['skillOverrides'] : {}
      const found = overrides[op.id]
      const before = typeof found === 'string' ? found : null
      if (before === op.after) continue
      if (op.after === null) delete overrides[op.id]
      else overrides[op.id] = op.after
      if (Object.keys(overrides).length > 0) updated['skillOverrides'] = overrides
      else delete updated['skillOverrides']
      applied.push({ ...op, before })
    } else if (op.kind === 'deny') {
      if (updated['permissions'] !== undefined && !isRecord(updated['permissions'])) {
        throw new Error('permissions is not an object')
      }
      const permissions = isRecord(updated['permissions']) ? updated['permissions'] : {}
      if (permissions['deny'] !== undefined && !Array.isArray(permissions['deny'])) {
        throw new Error('permissions.deny is not a list')
      }
      const deny: unknown[] = Array.isArray(permissions['deny']) ? [...permissions['deny']] : []
      const rule = skillRule(op.id)
      const before = deny.includes(rule)
      if (before === op.after) continue
      const nextDeny = op.after ? [...deny, rule] : deny.filter(entry => entry !== rule)
      if (nextDeny.length > 0) permissions['deny'] = nextDeny
      else delete permissions['deny']
      if (Object.keys(permissions).length > 0) updated['permissions'] = permissions
      else delete updated['permissions']
      applied.push({ ...op, before })
    } else {
      if (updated['enabledPlugins'] !== undefined && !isRecord(updated['enabledPlugins'])) {
        throw new Error('enabledPlugins is not an object')
      }
      const enabled = isRecord(updated['enabledPlugins']) ? updated['enabledPlugins'] : {}
      const found = enabled[op.id]
      const before = typeof found === 'boolean' ? found : null
      if (before === op.after) continue
      if (op.after === null) delete enabled[op.id]
      else enabled[op.id] = op.after
      if (Object.keys(enabled).length > 0) updated['enabledPlugins'] = enabled
      else delete updated['enabledPlugins']
      applied.push({ ...op, before })
    }
  }

  return { updated, applied }
}

/** The op that puts back what `op` changed. */
export function invert(op: Op): Op {
  switch (op.kind) {
    case 'override':
      return { ...op, before: op.after, after: op.before }
    case 'deny':
      return { ...op, before: op.after, after: op.before }
    case 'plugin':
      return { ...op, before: op.after, after: op.before }
    case 'session':
      return { ...op, before: op.after, after: op.before }
  }
}

// ---------------------------------------------------------------- the skill listing

const ENTRY = /^- (\S+?)(?:: .*)?$/

/**
 * Drops the entries of hidden skills from the listing Claude reads. An entry is
 * a `- name` or `- name: description` line plus the lines that continue it,
 * up to the next entry or a blank line; everything else is kept as it is.
 */
export function filterListing(text: string, isHidden: (name: string) => boolean): string {
  const out: string[] = []
  let isDropping = false

  for (const line of text.split('\n')) {
    const bare = line.replace(/\r$/, '')
    const name = ENTRY.exec(bare)?.[1]
    if (name !== undefined) isDropping = isHidden(name)
    else if (bare.trim() === '') isDropping = false
    if (!isDropping) out.push(line)
  }

  return out.join('\n')
}

// ---------------------------------------------------------------- what Claude is told

/** One note, sent beside the next prompt, listing what changed since the last one. */
export function noteFor(pending: Readonly<Record<string, PendingNote>>): string | null {
  const notes = Object.values(pending)
  if (notes.length === 0) return null

  const lines: string[] = []
  const add = (title: string, picked: readonly PendingNote[], withDescription: boolean) => {
    if (picked.length === 0) return
    lines.push(`${title}:`)
    for (const n of picked) {
      lines.push(withDescription && n.description !== '' ? `- ${n.id}: ${clip(n.description, 200)}` : `- ${n.id}`)
    }
  }
  const isUserOnly = (n: PendingNote) => n.isOn && n.level === 'user-invocable-only'
  add('Now OFF for this project', notes.filter(n => n.scope === 'project' && !n.isOn), false)
  add('Now OFF for this session', notes.filter(n => n.scope === 'session' && !n.isOn), false)
  add(
    'Now only for the user to run by typing /name, in this project (do not call these yourself)',
    notes.filter(n => n.scope === 'project' && isUserOnly(n)),
    false,
  )
  add('Now ON again for this project', notes.filter(n => n.scope === 'project' && n.isOn && !isUserOnly(n)), true)
  add('Now ON again for this session', notes.filter(n => n.scope === 'session' && n.isOn), true)

  return [
    'The user changed which skills are switched on, in the Skills panel.',
    ...lines,
    'Do not use a skill that is off, not even by copying its steps. A skill that is on again may be used when it fits.',
  ].join('\n')
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/** The short name a row shows inside its group: `wrangler` for `cloudflare:wrangler`. */
export function shortName(row: Pick<SkillRow, 'id' | 'kind'>): string {
  if (row.kind !== 'plugin' && row.kind !== 'app') return row.id
  const colon = row.id.indexOf(':')

  return colon > 0 ? row.id.slice(colon + 1) : row.id
}

const GROUP_RANK: Record<string, number> = { project: 0, global: 1, plugin: 2, app: 3, builtin: 4, other: 5 }

export function groupRank(group: string): number {
  return GROUP_RANK[group.split(':')[0] ?? 'other'] ?? 9
}

export function groupTitle(group: string): string {
  const [kind, name] = [group.split(':')[0], group.slice(group.indexOf(':') + 1)]
  switch (kind) {
    case 'project':
      return "This project's own skills"
    case 'global':
      return 'Your skills (all projects)'
    case 'plugin':
      return `Plugin · ${name}`
    case 'app':
      return `From the Claude app · ${name}`
    case 'builtin':
      return 'Built into Claude Code'
    default:
      return 'Other'
  }
}

/** A short word for where a skill comes from, as a row's tag shows it. */
export function sourceTag(row: Pick<SkillRow, 'kind' | 'group'>): string {
  const name = row.group.slice(row.group.indexOf(':') + 1)
  switch (row.kind) {
    case 'project':
      return 'this project'
    case 'global':
      return 'yours'
    case 'plugin':
      return `plugin ${name}`
    case 'app':
      return `app ${name}`
    case 'builtin':
      return 'built in'
    default:
      return 'not loaded'
  }
}

// ---------------------------------------------------------------- topics

/**
 * The topics the panel sorts skills into, in the order it lists them. A skill
 * goes to the topic whose words its name and description hit most (a word in
 * the name counts three times); ties go to the topic listed first. A word of
 * three letters or fewer counts only as a whole word, and the description
 * counts only words of five letters or more, so common words do not decide.
 */
export const TOPIC_RULES: readonly { name: string; words: readonly string[] }[] = [
  {
    name: 'Video & motion',
    words: [
      'video', 'motion', 'animat', 'remotion', 'remocn', 'ffmpeg', 'caption', 'subtitle', 'reel', 'reels', 'shorts',
      'tiktok', 'storyboard', 'kinetic', 'shot', 'shader', 'glsl', 'particle', 'lottie', 'gsap', 'beat', 'explainer',
      'film', 'trailer', 'manim', 'footage', 'cinematic',
    ],
  },
  {
    name: 'Audio & voice',
    words: ['music', 'sound', 'audio', 'speech', 'voice', 'narrat', 'podcast', 'transcri', 'whisper', 'tts', 'elevenlabs'],
  },
  {
    name: 'Design & brand',
    words: [
      'design', 'brand', 'logo', 'art', 'illustrat', 'palette', 'typograph', 'figma', 'dataviz', 'chart', 'diagram',
      'artifact', 'visual',
    ],
  },
  {
    name: 'Writing & social',
    words: [
      'copy', 'copywriting', 'social', 'post', 'posts', 'hook', 'viral', 'linkedin', 'twitter', 'tweet', 'ads',
      'marketing', 'slop', 'writing', 'blog', 'seo', 'newsletter',
    ],
  },
  {
    name: 'Research & papers',
    words: [
      'research', 'paper', 'papers', 'academic', 'citation', 'literature', 'proposal', 'prospectus', 'scholar', 'doi',
      'arxiv', 'thesis', 'ars', 'abstract', 'journal', 'pubmed', 'revision',
    ],
  },
  {
    name: 'Docs & office',
    words: [
      'docx', 'word', 'pdf', 'pptx', 'powerpoint', 'slide', 'slides', 'deck', 'xlsx', 'excel', 'spreadsheet', 'csv',
      'workspace', 'docs', 'document', 'presentation', 'ppt',
    ],
  },
  {
    name: 'Apps & code',
    words: [
      'expo', 'eas', 'react', 'next', 'nextjs', 'vercel', 'laravel', 'fastapi', 'api', 'cloudflare', 'wrangler',
      'worker', 'workers', 'durable', 'github', 'actions', 'gha', 'security', 'test', 'testing', 'tdd', 'code',
      'review', 'deploy', 'simulator', 'web', 'webapp', 'app', 'frontend', 'backend', 'database', 'docker', 'sandbox',
      'turnstile', 'build', 'release', 'version', 'simplify', 'debug', 'run', 'upgrade', 'gemini',
    ],
  },
  {
    name: 'Notes & memory',
    words: [
      'obsidian', 'canvas', 'markdown', 'note', 'notes', 'memory', 'mem', 'knowledge', 'graph', 'graphify',
      'defuddle', 'task', 'tasks', 'productivity', 'standup', 'vault', 'morning', 'digest', 'timeline', 'handoff',
      'learn',
    ],
  },
  {
    name: 'Claude & setup',
    words: [
      'claude', 'skill', 'skills', 'plugin', 'plugins', 'mod', 'config', 'settings', 'provider', 'mcp', 'agent',
      'agents', 'hook', 'keybinding', 'statusline', 'schedule', 'loop', 'cron', 'init', 'browser', 'chrome',
      'computer', 'usage', 'permission', 'model', 'autoharness', 'harness', 'cowork', 'workflow',
    ],
  },
]

export const OTHER_TOPIC = 'Other'

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word !== '')
}

/** Words almost every description uses ("Use this skill when Claude…"): they count in a name only. */
const NAME_ONLY_WORDS = new Set([
  'skill',
  'skills',
  'claude',
  'agent',
  'agents',
  'model',
  'plugin',
  'plugins',
  'settings',
  'usage',
  'workflow',
  'review',
  'build',
  'version',
  'release',
  'testing',
  'visual',
  'document',
])

function hits(words: readonly string[], keyword: string, isName: boolean): boolean {
  if (keyword.length <= 3) return words.includes(keyword)
  if (!isName && (keyword.length < 5 || NAME_ONLY_WORDS.has(keyword))) return false

  return words.some(word => word.startsWith(keyword))
}

function bestTopic(name: readonly string[], description: readonly string[]): string {
  let best = OTHER_TOPIC
  let bestScore = 0

  for (const rule of TOPIC_RULES) {
    let score = 0
    for (const keyword of rule.words) {
      if (hits(name, keyword, true)) score += 3
      else if (hits(description, keyword, false)) score += 1
    }
    if (score > bestScore) {
      best = rule.name
      bestScore = score
    }
  }

  return best
}

/**
 * The topic a skill is sorted into when the user has not picked one. A plugin's
 * skills stay together: the plugin's name decides for all of them. A Claude-app
 * skill (`anthropic-skills:pdf`) goes by its own name and description, and by
 * its app's name only when those say nothing.
 */
export function autoTopic(row: Pick<SkillRow, 'id' | 'kind' | 'description'>): string {
  const cacheKey = `${row.kind}\n${row.id}\n${row.description}`
  const cached = topicCache.get(cacheKey)
  if (cached !== undefined) return cached
  const topic = sortedTopic(row)
  if (topicCache.size > 2000) topicCache.clear()
  topicCache.set(cacheKey, topic)

  return topic
}

const topicCache = new Map<string, string>()

function sortedTopic(row: Pick<SkillRow, 'id' | 'kind' | 'description'>): string {
  const colon = row.id.indexOf(':')
  const prefix = colon > 0 ? row.id.slice(0, colon) : ''
  if (row.kind === 'plugin') return bestTopic(wordsOf(prefix === '' ? row.id : prefix), [])
  if (row.kind === 'app' && prefix !== '') {
    const own = bestTopic(wordsOf(row.id.slice(colon + 1)), wordsOf(row.description))

    return own !== OTHER_TOPIC ? own : bestTopic(wordsOf(prefix), [])
  }

  return bestTopic(wordsOf(row.id), wordsOf(row.description))
}

/** The topic a row is listed under: the user's pick, else the automatic one. */
export function topicOf(
  row: Pick<SkillRow, 'id' | 'kind' | 'description'>,
  picked: Readonly<Record<string, string>>,
): string {
  return picked[row.id] ?? autoTopic(row)
}

/** Topics in listing order: the built-in ones, then the user's own (A to Z), then Other. */
export function topicRank(topic: string): number {
  if (topic === OTHER_TOPIC) return 1000
  const index = TOPIC_RULES.findIndex(rule => rule.name === topic)

  return index >= 0 ? index : 500
}

/** A topic name as the user typed it: one line, trimmed, at most 40 characters. */
export function cleanTopic(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 40).trim()
}

/** The topic a Focus always keeps on, with Claude Code's built-in skills. */
export const SETUP_TOPIC = 'Claude & setup'

// ---------------------------------------------------------------- numbers and words

export const DAY_MS = 24 * 60 * 60 * 1000

/** A count with its word: `1 skill`, `3 skills`. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** How long ago, in plain words: `just now`, `3 min ago`, `2 days ago`. */
export function ago(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${count(hours, 'hour')} ago`
  const days = Math.floor(hours / 24)
  if (days < 60) return `${count(days, 'day')} ago`

  return `${count(Math.floor(days / 30), 'month')} ago`
}

/** A token count as a short figure: `640`, `7.9k`, `12k`. */
export function shortCount(n: number): string {
  if (n < 1000) return String(Math.round(n))
  const k = n / 1000

  return k < 10 ? `${k.toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(k)}k`
}

/**
 * Splits `cells` among parts by their values, largest remainders first, so the
 * counts always add up to `cells`; a part with a value keeps at least one cell
 * while another part can spare one.
 */
export function shareCells(values: readonly number[], cells: number): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0 || cells <= 0) return values.map(() => 0)
  const exact = values.map(value => (Math.max(0, value) / total) * cells)
  const counts = exact.map(value => Math.floor(value))
  let left = cells - counts.reduce((sum, count) => sum + count, 0)
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest)
  for (const { i } of order) {
    if (left <= 0) break
    counts[i] = (counts[i] ?? 0) + 1
    left--
  }
  for (let i = 0; i < counts.length; i++) {
    if ((values[i] ?? 0) <= 0 || (counts[i] ?? 0) > 0) continue
    const donor = counts.indexOf(Math.max(...counts))
    if ((counts[donor] ?? 0) > 1) {
      counts[donor] = (counts[donor] ?? 0) - 1
      counts[i] = 1
    }
  }

  return counts
}
