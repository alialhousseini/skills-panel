// What the Skills page shows, worked out from what was read. No `$`, so the
// tests can call it directly.
import type { Inventory, Level, PluginStatus, ProjectView, Show, SkillRow, UsageView, UseCount, View } from '../types'
import { paletteColor } from './charts'
import {
  DAY_MS,
  LAYER_NAMES,
  LEVEL_TAGS,
  TOPIC_RULES,
  allDenyRules,
  denySources,
  enabledOf,
  groupRank,
  groupTitle,
  isRecord,
  levelOf,
  overrideOf,
  topicOf,
  topicRank,
  usesDeny,
} from './lib'
import type { Layer } from './lib'

/** A deny rule the panel wrote: `Skill(<id>)`, nothing wider. */
export const PANEL_RULE = /^Skill\(([^\s*()]+)\)$/

/** The skills a settings.local.json switches off itself: its `off` overrides and the panel's deny rules. */
export function localOff(local: Readonly<Record<string, unknown>>): string[] {
  const ids: string[] = []
  const overrides = local['skillOverrides']
  if (isRecord(overrides)) {
    for (const [id, value] of Object.entries(overrides)) if (value === 'off') ids.push(id)
  }
  for (const rule of allDenyRules([{ source: 'local', settings: local }])) {
    const id = PANEL_RULE.exec(rule)?.[1]
    if (id !== undefined) ids.push(id)
  }

  return [...new Set(ids)]
}

/** Skills the panel switched off that are not loaded now still get a row, so they can come back. */
export function withOrphans(
  inv: Inventory,
  local: Readonly<Record<string, unknown>>,
  sessionIds: readonly string[],
): Inventory {
  const known = new Set(inv.skills.map(skill => skill.id))
  const extra: SkillRow[] = []
  for (const id of [...localOff(local), ...sessionIds]) {
    if (known.has(id)) continue
    known.add(id)
    extra.push({
      id,
      kind: 'other',
      group: 'other',
      description: 'Not loaded right now (it is off, or its plugin is off).',
      isManual: false,
      note: null,
      tokens: null,
    })
  }

  return extra.length === 0 ? inv : { ...inv, skills: [...inv.skills, ...extra] }
}

/** What is on, off and locked in a folder, from its settings layers (lowest first). */
export function viewOf(inv: Inventory, layers: readonly Layer[], fileError: string | null): ProjectView {
  const off: string[] = []
  const locked: Record<string, string> = {}
  const tags: Record<string, string> = {}
  const levels: Record<string, Level> = {}
  const onLevels: Record<string, Level> = {}
  const lower = layers.filter(layer => layer.source === 'user' || layer.source === 'project')

  for (const row of inv.skills) {
    const denied = denySources(layers, row.id)
    const deniedElsewhere = usesDeny(row) ? denied.find(source => source !== 'local') : denied[0]
    if (usesDeny(row)) {
      if (denied.length > 0) off.push(row.id)
    } else {
      const { value, source } = overrideOf(layers, row.id)
      const level = levelOf(value)
      if (level === 'off' || denied.length > 0) off.push(row.id)
      if (level === 'name-only' || level === 'user-invocable-only') levels[row.id] = level
      if (source === 'flag' || source === 'policy') locked[row.id] = `set by ${LAYER_NAMES[source]}`
      else if (level !== 'on' && source !== undefined && source !== 'local') {
        tags[row.id] = `${LEVEL_TAGS[level] ?? 'off'} in ${LAYER_NAMES[source]}`
      }
      const inherited = levelOf(overrideOf(lower, row.id).value)
      if (inherited === 'name-only' || inherited === 'user-invocable-only') onLevels[row.id] = inherited
    }
    if (deniedElsewhere !== undefined) locked[row.id] = `blocked in ${LAYER_NAMES[deniedElsewhere]}`
  }

  // What the folder's own file changes: its skillOverrides keys and the panel's deny rules.
  const local = layers.find(layer => layer.source === 'local')?.settings ?? {}
  const touched = new Set<string>()
  const overrides = local['skillOverrides']
  if (isRecord(overrides)) for (const id of Object.keys(overrides)) touched.add(id)
  for (const rule of allDenyRules([{ source: 'local', settings: local }])) {
    const id = PANEL_RULE.exec(rule)?.[1]
    if (id !== undefined) touched.add(id)
  }
  const changed = inv.skills.filter(row => touched.has(row.id)).map(row => row.id)

  const plugins = inv.plugins.map(plugin => {
    const { value, source } = enabledOf(layers, plugin.id)

    return {
      id: plugin.id,
      isOn: value ?? plugin.hasSkills,
      lockedBy: source === 'flag' || source === 'policy' ? LAYER_NAMES[source] : null,
    }
  })

  return { off, locked, tags, levels, onLevels, changed, plugins, fileError }
}

/** The level in force for each skill of a folder. */
export function levelsNow(pv: Pick<ProjectView, 'off' | 'levels'>): (id: string) => Level {
  const off = new Set(pv.off)

  return id => pv.levels[id] ?? (off.has(id) ? 'off' : 'on')
}

export type Group = {
  key: string
  title: string
  color: string
  /** Every row of the group. */
  rows: SkillRow[]
  /** The rows the search and the Show filter let through. */
  shown: SkillRow[]
  /** The whole plugin's switch, in the source view. */
  plugin: PluginStatus | undefined
}

export type Model = {
  inv: Inventory
  pv: ProjectView
  current: View
  offInSession: Set<string>
  projectOff: Set<string>
  picked: Record<string, string>
  /** The switches act on this session only. Never while another folder is managed. */
  isSession: boolean
  /** Another folder than the session's is shown. */
  isOther: boolean
  needle: string
  /** What a row's switch shows in the scope picked. */
  isOn: (row: SkillRow) => boolean
  /** On in this session: off neither for the project nor for the session. */
  isLive: (row: SkillRow) => boolean
  /** Why the panel cannot switch a row in the scope picked, or null. */
  lockOf: (row: SkillRow) => string | null
  /** The project level in force. */
  levelNow: (row: SkillRow) => Level
  /** How often it was used in the folder shown, when it was. */
  usedOf: (row: SkillRow) => UseCount | undefined
  /** On here, and not used here for the days the option names. */
  isUnused: (row: SkillRow) => boolean
  changed: Set<string>
  groups: Group[]
  counts: Record<Show, number>
}

function matches(row: SkillRow, needle: string): boolean {
  return needle === '' || row.id.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle)
}

export function buildModel(
  inv: Inventory,
  pv: ProjectView,
  current: View,
  offList: readonly string[],
  picked: Record<string, string>,
  used: UsageView,
): Model {
  const isOther = inv.isOther
  const isSession = !isOther && current.scope === 'session'
  const offInSession = new Set(isOther ? [] : offList)
  const projectOff = new Set(pv.off)
  const isLive = (row: SkillRow) => !projectOff.has(row.id) && !offInSession.has(row.id)
  const isOn = (row: SkillRow) => (isSession ? isLive(row) : !projectOff.has(row.id))
  const lockOf = (row: SkillRow) =>
    isSession ? (projectOff.has(row.id) ? 'off for this project' : null) : (pv.locked[row.id] ?? null)
  const levelNow = (row: SkillRow): Level => pv.levels[row.id] ?? (projectOff.has(row.id) ? 'off' : 'on')
  const usedOf = (row: SkillRow) => used.here[row.id]
  const quiet = used.unusedDays * DAY_MS
  // "Unused for 30 days" can only be said once uses have been counted here for 30 days.
  const isCountedLongEnough = used.isTracking && used.since !== null && used.now - used.since >= quiet
  const isUnused = (row: SkillRow) => {
    if (!isCountedLongEnough || !isOn(row) || row.kind === 'other') return false
    const use = used.here[row.id]

    return use === undefined || used.now - use.last >= quiet
  }
  const changed = new Set(isSession ? offList : pv.changed)
  const needle = current.filter.trim().toLowerCase()
  const passes = (row: SkillRow) =>
    current.show === 'on'
      ? isOn(row)
      : current.show === 'off'
        ? !isOn(row)
        : current.show === 'changed'
          ? changed.has(row.id)
          : current.show === 'unused'
            ? isUnused(row)
            : true
  const found = inv.skills.filter(row => matches(row, needle))
  const counts: Record<Show, number> = {
    all: found.length,
    on: found.filter(isOn).length,
    off: found.filter(row => !isOn(row)).length,
    changed: found.filter(row => changed.has(row.id)).length,
    unused: found.filter(isUnused).length,
  }

  const isTopic = current.groupBy === 'topic'
  const keyById = new Map(inv.skills.map(row => [row.id, isTopic ? `topic:${topicOf(row, picked)}` : row.group]))
  const keyOf = (row: SkillRow) => keyById.get(row.id) ?? row.group
  const titleOf = (key: string) => (isTopic ? key.slice('topic:'.length) : groupTitle(key))
  const keys = new Set(keyById.values())
  if (!isTopic) for (const plugin of inv.plugins) keys.add(`plugin:${plugin.name}`)
  const ordered = [...keys].sort(
    isTopic
      ? (a, b) => topicRank(titleOf(a)) - topicRank(titleOf(b)) || titleOf(a).localeCompare(titleOf(b))
      : (a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b),
  )
  const groups = ordered.map((key, index): Group => {
    const rows = inv.skills.filter(row => keyOf(row) === key)
    const title = titleOf(key)
    const rank = topicRank(title)
    const pluginName = !isTopic && key.startsWith('plugin:') ? key.slice('plugin:'.length) : undefined
    const entry = pluginName === undefined ? undefined : inv.plugins.find(plugin => plugin.name === pluginName)

    return {
      key,
      title,
      color: paletteColor(isTopic && rank < TOPIC_RULES.length ? rank : index),
      rows,
      shown: rows.filter(row => matches(row, needle) && passes(row)),
      plugin: entry === undefined ? undefined : pv.plugins.find(plugin => plugin.id === entry.id),
    }
  })

  return {
    inv,
    pv,
    current,
    offInSession,
    projectOff,
    picked,
    isSession,
    isOther,
    needle,
    isOn,
    isLive,
    lockOf,
    levelNow,
    usedOf,
    isUnused,
    changed,
    groups,
    counts,
  }
}

/** The topics that have skills, in listing order: what a Focus can be put on. */
export function topicsWithSkills(rows: readonly SkillRow[], picked: Readonly<Record<string, string>>): string[] {
  const names = new Set(rows.filter(row => row.kind !== 'other').map(row => topicOf(row, picked)))

  return [...names].sort((a, b) => topicRank(a) - topicRank(b) || a.localeCompare(b))
}
