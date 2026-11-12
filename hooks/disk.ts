// What the panel reads from disk and from the engine, and the one git file it
// may add a line to. These functions take `$` but keep no state.
//
// In another folder than the session's, only two things are ever read:
// `.claude/settings.local.json` and `.claude/skills/*/SKILL.md`.
import type { EngineInterface } from 'claude-code'

import type { Budget, Inventory, PluginEntry, ProjectView, SkillRow } from '../types'
import { baseName, groupRank, isRecord, join, parseFrontmatter, parseSettings, samePath } from './lib'
import type { Layer } from './lib'
import { localOff, viewOf, withOrphans } from './model'

export type Engine = EngineInterface

const SELF = 'skills-panel'
const SETTINGS_PATH = '.claude/settings.local.json'

type Found = { id: string; description: string; isManual: boolean }
type Listed = { source: string; pluginName?: string; tokens: number }

export type Places = {
  home: string
  configDir: string
  /** Claude Code's own config file, which lists the folders it was used in. */
  configFile: string
  /** The folder this session runs in. */
  root: string
}

export async function locate($: Engine): Promise<Places> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  const configDir = custom ?? join(home, '.claude')
  const root = await $.session.root()

  return { home, configDir, configFile: join(custom ?? home, '.claude.json'), root }
}

export function settingsFile(root: string): string {
  return join(root, '.claude', 'settings.local.json')
}

async function scanSkillDir($: Engine, dir: string): Promise<Found[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  const found = await Promise.all(
    entries
      .filter(entry => !entry.name.startsWith('.') && entry.kind !== 'file')
      .map(async (entry): Promise<Found | null> => {
        const file = join(dir, entry.name, 'SKILL.md')
        try {
          if (!(await $.fs.exists(file))) return null
          const meta = parseFrontmatter(await $.fs.read(file))

          return {
            id: entry.name,
            description: meta['description'] ?? '',
            isManual: meta['disable-model-invocation'] === 'true',
          }
        } catch {
          return null
        }
      }),
  )

  return found.filter((item): item is Found => item !== null)
}

async function installedPlugins($: Engine, configDir: string): Promise<string[]> {
  try {
    const raw: unknown = JSON.parse(await $.fs.read(join(configDir, 'plugins', 'installed_plugins.json')))

    return isRecord(raw) && isRecord(raw['plugins']) ? Object.keys(raw['plugins']) : []
  } catch {
    return []
  }
}

/** The skills Claude's listing carries now, with the engine's word for their source and their tokens. */
async function listedSkills($: Engine): Promise<{ listed: Map<string, Listed>; budget: Budget | null }> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const skills = usage.context.breakdown?.skills
    if (skills === undefined) return { listed: new Map(), budget: null }

    return {
      listed: new Map(
        (skills.skillFrontmatter ?? []).map(skill => [
          skill.name,
          { source: String(skill.source), pluginName: skill.pluginName, tokens: skill.tokens },
        ]),
      ),
      budget: { total: skills.totalSkills, included: skills.includedSkills, tokens: skills.tokens },
    }
  } catch {
    return { listed: new Map(), budget: null }
  }
}

function bySource(a: SkillRow, b: SkillRow): number {
  return groupRank(a.group) - groupRank(b.group) || a.group.localeCompare(b.group) || a.id.localeCompare(b.id)
}

/** Every skill of the folder this session runs in. */
export async function buildInventory($: Engine): Promise<Inventory> {
  const { home, configDir, root } = await locate($)
  const isHome = samePath(root, home)
  const [globals, locals, installed, commands, { listed, budget }] = await Promise.all([
    scanSkillDir($, join(configDir, 'skills')),
    isHome ? Promise.resolve<Found[]>([]) : scanSkillDir($, join(root, '.claude', 'skills')),
    installedPlugins($, configDir),
    $.command.list().catch(() => []),
    listedSkills($),
  ])

  const rows = new Map<string, SkillRow>()
  const add = (row: Omit<SkillRow, 'tokens'>) => {
    if (!rows.has(row.id)) rows.set(row.id, { ...row, tokens: null })
  }
  const described = new Map(commands.map(command => [command.name, command.description]))

  for (const skill of globals) {
    add({ ...skill, kind: 'global', group: 'global', note: null })
  }
  for (const skill of locals) {
    const same = rows.get(skill.id)
    if (same) same.note = 'also in this project (this one runs)'
    else add({ ...skill, kind: 'project', group: 'project', note: null })
  }

  const installedNames = new Set(installed.map(id => id.split('@')[0] ?? id))
  const addPluginSkill = (id: string, pluginName: string, description: string) => {
    if (pluginName === SELF) return
    const kind = installedNames.has(pluginName) ? 'plugin' : 'app'
    add({ id, kind, group: `${kind}:${pluginName}`, description, isManual: false, note: null })
  }

  for (const command of commands) {
    if (command.source === 'plugin') {
      const colon = command.name.indexOf(':')
      if (colon > 0) addPluginSkill(command.name, command.plugin ?? command.name.slice(0, colon), command.description)
    } else if (command.source === 'user' && !rows.has(command.name)) {
      const source = listed.get(command.name)?.source
      const kind = source === 'projectSettings' ? 'project' : source === 'userSettings' ? 'global' : 'other'
      add({ id: command.name, kind, group: kind, description: command.description, isManual: false, note: null })
    }
  }
  for (const [name, info] of listed) {
    if (rows.has(name)) continue
    const description = described.get(name) ?? ''
    if (info.source === 'built-in') {
      add({ id: name, kind: 'builtin', group: 'builtin', description, isManual: false, note: null })
    } else if (info.source === 'plugin' && name.includes(':')) {
      addPluginSkill(name, info.pluginName ?? name.slice(0, name.indexOf(':')), description)
    } else if (info.source === 'syncedSkills') {
      add({ id: name, kind: 'app', group: 'app:claude.ai', description, isManual: false, note: null })
    }
  }
  for (const row of rows.values()) {
    if (row.description === '') row.description = described.get(row.id) ?? ''
    row.tokens = listed.get(row.id)?.tokens ?? null
  }

  const skills = [...rows.values()].sort(bySource)
  const plugins: PluginEntry[] = installed
    .map(id => {
      const name = id.split('@')[0] ?? id

      return { id, name, hasSkills: skills.some(skill => skill.group === `plugin:${name}`) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    root,
    project: baseName(root),
    file: settingsFile(root),
    isHome,
    isOther: false,
    skills,
    plugins,
    budget,
  }
}

/**
 * The skills of another folder: everything that is the same everywhere (your
 * skills, plugins, the Claude app's, the built-in ones) as this session has
 * them, plus that folder's own `.claude/skills`.
 */
export async function inventoryFor($: Engine, here: Inventory, root: string): Promise<Inventory> {
  const { home } = await locate($)
  const isHome = samePath(root, home)
  const locals = isHome ? [] : await scanSkillDir($, join(root, '.claude', 'skills'))
  const rows = new Map<string, SkillRow>()
  for (const row of here.skills) {
    if (row.kind !== 'project' && row.kind !== 'other') rows.set(row.id, { ...row, note: null })
  }
  for (const skill of locals) {
    const same = rows.get(skill.id)
    if (same) same.note = 'also in that folder (that one runs)'
    else rows.set(skill.id, { ...skill, kind: 'project', group: 'project', note: null, tokens: null })
  }

  return {
    root,
    project: baseName(root),
    file: settingsFile(root),
    isHome,
    isOther: true,
    skills: [...rows.values()].sort(bySource),
    plugins: here.plugins,
    budget: null,
  }
}

export async function readLocal(
  $: Engine,
  file: string,
): Promise<{ value: Record<string, unknown> } | { error: string }> {
  try {
    const text = (await $.fs.exists(file)) ? await $.fs.read(file) : null

    return parseSettings(text)
  } catch {
    return { error: 'could not be read' }
  }
}

/**
 * Every settings source for a folder, lowest first, with its local file as
 * just read. For another folder only your user settings and managed policy
 * are known besides: its shared settings file is not read.
 */
export async function layersFor(
  $: Engine,
  inv: Pick<Inventory, 'isOther'>,
  local: Readonly<Record<string, unknown>>,
): Promise<Layer[]> {
  const one = (source: 'user' | 'project' | 'flag' | 'policy') =>
    $.settings.read({ source }).catch((): Readonly<Record<string, unknown>> => ({}))
  if (inv.isOther) {
    const [user, policy] = await Promise.all([one('user'), one('policy')])

    return [
      { source: 'user', settings: user },
      { source: 'local', settings: local },
      { source: 'policy', settings: policy },
    ]
  }
  const [user, shared, flag, policy] = await Promise.all([one('user'), one('project'), one('flag'), one('policy')])

  return [
    { source: 'user', settings: user },
    { source: 'project', settings: shared },
    { source: 'local', settings: local },
    { source: 'flag', settings: flag },
    { source: 'policy', settings: policy },
  ]
}

/** The settings a folder's own file sits on: your user settings and, here, the project's shared ones. */
export async function lowerLayers($: Engine, inv: Pick<Inventory, 'isOther' | 'file'>): Promise<Layer[]> {
  const local = await readLocal($, inv.file)
  const layers = await layersFor($, inv, 'value' in local ? local.value : {})

  return layers.filter(layer => layer.source === 'user' || layer.source === 'project')
}

/** A folder's skills with what is on and off there, read fresh from its settings. */
export async function loadView(
  $: Engine,
  base: Inventory,
  sessionIds: readonly string[],
): Promise<{ inv: Inventory; pv: ProjectView }> {
  const local = await readLocal($, base.file)
  const localValue = 'value' in local ? local.value : {}
  const inv = withOrphans(base, localValue, base.isOther ? [] : sessionIds)
  const layers = await layersFor($, inv, localValue)

  return { inv, pv: viewOf(inv, layers, 'error' in local ? `${inv.file} ${local.error}` : null) }
}

/** What a folder's own settings.local.json changes, for its card on the Projects page. */
export async function folderStats(
  $: Engine,
  path: string,
): Promise<{ off: number; nameOnly: number; error: string | null }> {
  const local = await readLocal($, settingsFile(path))
  if ('error' in local) return { off: 0, nameOnly: 0, error: `Its settings.local.json ${local.error}` }
  const overrides = local.value['skillOverrides']
  const nameOnly = isRecord(overrides) ? Object.values(overrides).filter(value => value === 'name-only').length : 0

  return { off: localOff(local.value).length, nameOnly, error: null }
}

/**
 * The folders Claude Code lists in its own config file. Only the keys of its
 * `projects` map are read: nothing else from that file is looked at, shown or
 * kept. A file that is missing, too large or not JSON gives an empty list.
 */
export async function claudeProjects($: Engine): Promise<string[]> {
  try {
    const { configFile } = await locate($)
    const raw: unknown = JSON.parse(await $.fs.read(configFile))

    return isRecord(raw) && isRecord(raw['projects']) ? Object.keys(raw['projects']) : []
  } catch {
    return []
  }
}

/** Which of the folders are there. */
export async function existing($: Engine, paths: readonly string[]): Promise<boolean[]> {
  return Promise.all(paths.map(path => $.fs.exists(path).catch(() => false)))
}

function isAbsolute(path: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(path)
}

/**
 * Called right after the panel created a folder's settings.local.json. When
 * the folder is in a git repository and git does not ignore that file, its
 * path is added to the repository's own `.git/info/exclude`, which stays on
 * this computer; `.gitignore` is never touched. Resolves true when a line was
 * added. Says nothing when git is missing or the folder is no repository.
 */
export async function keepOutOfGit($: Engine, root: string): Promise<boolean> {
  try {
    const run = (argv: readonly string[]) => $.process.run(argv, { cwd: root, timeoutMs: 5000 })
    // 0: ignored already. 1: not ignored. 128: not a git repository.
    const check = await run(['git', 'check-ignore', '-q', SETTINGS_PATH])
    if (check.exitCode !== 1) return false
    const where = await run(['git', 'rev-parse', '--show-prefix', '--git-path', 'info/exclude'])
    if (where.exitCode !== 0) return false
    const [prefix = '', gitPath = ''] = where.stdout.split(/\r?\n/)
    if (gitPath.trim() === '') return false
    const file = isAbsolute(gitPath.trim()) ? gitPath.trim() : join(root, gitPath.trim())
    const line = `/${prefix.trim().replace(/[\\*?[\]]/g, '\\$&')}${SETTINGS_PATH}`
    const text = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
    if (text.split(/\r?\n/).some(one => one.trim() === line)) return false
    await $.fs.write(file, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`)

    return true
  } catch {
    return false
  }
}
