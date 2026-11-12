// Profiles: a saved setup (which skills are off, which are at a finer level),
// what applying one would change, and which folders suggest one. No `$`.
import type { FolderRule, Level, Profile, ProfileLevel, Profiles, ProjectView, SkillRow } from '../types'
import { count, folderKey, isRecord, usesDeny } from './lib'

/** How many deleted profiles stay restorable. */
export const DELETED_KEEP = 5

/** A profile name as typed: one line, trimmed, at most 40 characters. */
export function cleanName(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 40).trim()
}

/** A short id made from the name (`video-work`), with a number when it is taken. */
export function profileId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/, '') || 'profile'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++

  return `${base}-${n}`
}

function isProfileLevel(value: unknown): value is ProfileLevel {
  return value === 'name-only' || value === 'user-invocable-only'
}

function readProfile(raw: unknown): Profile | null {
  if (!isRecord(raw)) return null
  const { id, name } = raw
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') return null
  const off = Array.isArray(raw['off']) ? raw['off'].filter((one): one is string => typeof one === 'string') : []
  const levels: Record<string, ProfileLevel> = {}
  if (isRecord(raw['levels'])) {
    for (const [skill, level] of Object.entries(raw['levels'])) if (isProfileLevel(level)) levels[skill] = level
  }
  const folders: FolderRule[] = []
  if (Array.isArray(raw['folders'])) {
    for (const rule of raw['folders']) {
      if (isRecord(rule) && typeof rule['path'] === 'string' && rule['path'] !== '') {
        folders.push({ path: rule['path'], withSubfolders: rule['withSubfolders'] !== false })
      }
    }
  }
  const createdAt = typeof raw['createdAt'] === 'number' ? raw['createdAt'] : 0

  return {
    id,
    name: cleanName(name) || id,
    off: [...new Set(off)],
    levels,
    folders,
    createdAt,
    updatedAt: typeof raw['updatedAt'] === 'number' ? raw['updatedAt'] : createdAt,
  }
}

/** The stored profiles, with anything that is not a profile left out. */
export function readProfiles(raw: unknown): Profiles {
  if (!isRecord(raw) || raw['version'] !== 1) return { items: [], deleted: [] }
  const list = (value: unknown) =>
    Array.isArray(value) ? value.map(readProfile).filter((one): one is Profile => one !== null) : []
  const items = list(raw['items'])
  const taken = new Set(items.map(one => one.id))

  return { items, deleted: list(raw['deleted']).filter(one => !taken.has(one.id)).slice(0, DELETED_KEEP) }
}

/** What a card says a profile holds: `23 off · 2 name only`. */
export function profileSummary(profile: Pick<Profile, 'off' | 'levels'>): string {
  const levels = Object.values(profile.levels)
  const nameOnly = levels.filter(level => level === 'name-only').length
  const onlyYou = levels.length - nameOnly

  return [`${profile.off.length} off`, `${nameOnly} name only`, ...(onlyYou > 0 ? [`${onlyYou} only you`] : [])].join(
    ' · ',
  )
}

/** A folder's setup as a profile holds it: its off list and its finer levels. */
export function snapshotProject(
  pv: Pick<ProjectView, 'off' | 'levels'>,
  rows: readonly SkillRow[],
): Pick<Profile, 'off' | 'levels'> {
  const known = new Set(rows.map(row => row.id))
  const off = pv.off.filter(id => known.has(id))
  const isOff = new Set(off)
  const levels: Record<string, ProfileLevel> = {}
  for (const [id, level] of Object.entries(pv.levels)) {
    if (known.has(id) && !isOff.has(id) && isProfileLevel(level)) levels[id] = level
  }

  return { off, levels }
}

/** This session's setup: everything that is off in it. A session has no finer levels. */
export function snapshotSession(
  rows: readonly SkillRow[],
  projectOff: ReadonlySet<string>,
  sessionOff: ReadonlySet<string>,
): Pick<Profile, 'off' | 'levels'> {
  return { off: rows.filter(row => projectOff.has(row.id) || sessionOff.has(row.id)).map(row => row.id), levels: {} }
}

export type ProjectPlan = {
  /** The level each skill that differs would get. */
  targets: { id: string; level: Level }[]
  off: number
  on: number
  nameOnly: number
  onlyYou: number
  /** In the profile, but not installed in this folder. */
  skipped: number
  /** Would change, but other settings lock it. */
  locked: number
}

/**
 * What makes a folder match a profile. Each known skill goes to the profile's
 * level for it, else off when the profile lists it, else to what "on" means in
 * that folder. Plugin and app skills are only on or off.
 */
export function planProject(
  profile: Pick<Profile, 'off' | 'levels'>,
  rows: readonly SkillRow[],
  pv: Pick<ProjectView, 'off' | 'levels' | 'locked' | 'onLevels'>,
): ProjectPlan {
  const wantOff = new Set(profile.off)
  const offNow = new Set(pv.off)
  const known = new Set(rows.map(row => row.id))
  const targets: { id: string; level: Level }[] = []
  const tally: Record<Level, number> = { on: 0, 'name-only': 0, 'user-invocable-only': 0, off: 0 }
  let locked = 0

  for (const row of rows) {
    const now: Level = pv.levels[row.id] ?? (offNow.has(row.id) ? 'off' : 'on')
    const wanted: Level = usesDeny(row)
      ? wantOff.has(row.id)
        ? 'off'
        : 'on'
      : (profile.levels[row.id] ?? (wantOff.has(row.id) ? 'off' : (pv.onLevels[row.id] ?? 'on')))
    if (wanted === now) continue
    if (pv.locked[row.id] !== undefined) {
      locked++
      continue
    }
    targets.push({ id: row.id, level: wanted })
    tally[wanted]++
  }
  const named = new Set([...profile.off, ...Object.keys(profile.levels)])

  return {
    targets,
    off: tally.off,
    on: tally.on,
    nameOnly: tally['name-only'],
    onlyYou: tally['user-invocable-only'],
    skipped: [...named].filter(id => !known.has(id)).length,
    locked,
  }
}

export type SessionPlan = { turnOff: string[]; turnOn: string[]; skipped: number }

/**
 * What makes this session match a profile: its off list becomes the session's,
 * less what is already off for the project. Levels do not apply to a session.
 */
export function planSession(
  profile: Pick<Profile, 'off'>,
  rows: readonly SkillRow[],
  projectOff: ReadonlySet<string>,
  sessionOff: ReadonlySet<string>,
): SessionPlan {
  const known = new Set(rows.map(row => row.id))
  const wanted = new Set(profile.off.filter(id => known.has(id) && !projectOff.has(id)))

  return {
    turnOff: [...wanted].filter(id => !sessionOff.has(id)),
    turnOn: [...sessionOff].filter(id => !wanted.has(id)),
    skipped: profile.off.filter(id => !known.has(id)).length,
  }
}

function changes(parts: readonly (string | false)[]): string {
  return parts.filter((part): part is string => part !== false).join(', ')
}

function skippedNote(skipped: number): string {
  return skipped > 0 ? ` ${count(skipped, 'skill')} in it ${skipped === 1 ? "isn't" : "aren't"} installed here (skipped).` : ''
}

/** The one-line preview of a project apply: "Turns 12 off, 3 on, 1 to name only in proj." */
export function projectPlanText(plan: ProjectPlan, folder: string): string {
  const what = changes([
    plan.off > 0 && `${plan.off} off`,
    plan.on > 0 && `${plan.on} on`,
    plan.nameOnly > 0 && `${plan.nameOnly} to name only`,
    plan.onlyYou > 0 && `${plan.onlyYou} to only you`,
  ])
  const lockedNote = plan.locked > 0 ? ` ${count(plan.locked, 'skill')} locked by other settings stay as they are.` : ''

  return `${what === '' ? `${folder} already matches it.` : `Turns ${what} in ${folder}.`}${skippedNote(plan.skipped)}${lockedNote}`
}

/** The one-line preview of a session apply. */
export function sessionPlanText(plan: SessionPlan): string {
  const what = changes([plan.turnOff.length > 0 && `${plan.turnOff.length} off`, plan.turnOn.length > 0 && `${plan.turnOn.length} on`])

  return `${what === '' ? 'This chat already matches it.' : `Turns ${what} for this chat. Levels are ignored for a chat.`}${skippedNote(plan.skipped)}`
}

/**
 * The profiles whose folder rules cover `here` (a folder key), deepest rule
 * first: a rule for the folder itself, or for a folder above it that includes
 * subfolders.
 */
export function matchRules(profiles: readonly Profile[], here: string): Profile[] {
  const found: { profile: Profile; depth: number }[] = []
  for (const profile of profiles) {
    let best = -1
    for (const rule of profile.folders) {
      const key = folderKey(rule.path)
      const isMatch = key === here || (rule.withSubfolders && here.startsWith(key.endsWith('/') ? key : `${key}/`))
      if (isMatch && key.length > best) best = key.length
    }
    if (best >= 0) found.push({ profile, depth: best })
  }

  return found.sort((a, b) => b.depth - a.depth).map(one => one.profile)
}

/** The key a "Never here" or "Not now" is kept under. */
export function rulePair(folder: string, profile: string): string {
  return `${folder}|${profile}`
}
