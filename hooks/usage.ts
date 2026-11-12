// Usage: how often each skill really runs in each folder. Kept on this
// computer only, in the panel's own store. No `$`.
import type { UsageView, UseCount } from '../types'
import { ago, isRecord } from './lib'

export type FolderUse = { since: number; skills: Record<string, UseCount> }
export type UsageStore = { version: 1; folders: Record<string, FolderUse> }

/** How many folders are remembered; the one used longest ago goes first. */
export const USAGE_MAX_FOLDERS = 200

const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

/** The stored usage, with anything that is not a count left out. */
export function readUsage(raw: unknown): UsageStore {
  const out: UsageStore = { version: 1, folders: {} }
  if (!isRecord(raw) || raw['version'] !== 1 || !isRecord(raw['folders'])) return out
  for (const [key, folder] of Object.entries(raw['folders'])) {
    if (!isRecord(folder)) continue
    const skills: Record<string, UseCount> = {}
    if (isRecord(folder['skills'])) {
      for (const [id, use] of Object.entries(folder['skills'])) {
        if (!isRecord(use)) continue
        const one = { claude: number(use['claude']), you: number(use['you']), last: number(use['last']) }
        if (one.claude + one.you > 0) skills[id] = one
      }
    }
    out.folders[key] = { since: number(folder['since']), skills }
  }

  return out
}

/** When a folder was last active: its newest use, or when counting began there. */
function lastActive(folder: FolderUse): number {
  return Object.values(folder.skills).reduce((max, use) => Math.max(max, use.last), folder.since)
}

function capped(store: UsageStore): UsageStore {
  const keys = Object.keys(store.folders)
  if (keys.length <= USAGE_MAX_FOLDERS) return store
  const keep = keys
    .map(key => ({ key, at: lastActive(store.folders[key] ?? { since: 0, skills: {} }) }))
    .sort((a, b) => b.at - a.at)
    .slice(0, USAGE_MAX_FOLDERS)
  const folders: Record<string, FolderUse> = {}
  for (const { key } of keep) {
    const folder = store.folders[key]
    if (folder !== undefined) folders[key] = folder
  }

  return { version: 1, folders }
}

/** The store with counting begun in a folder, when it had not; null when it had. */
export function began(store: UsageStore, folder: string, now: number): UsageStore | null {
  if (store.folders[folder] !== undefined) return null

  return capped({ version: 1, folders: { ...store.folders, [folder]: { since: now, skills: {} } } })
}

/** The store with one more use of a skill in a folder, by Claude or by the user. */
export function counted(store: UsageStore, folder: string, id: string, who: 'claude' | 'you', now: number): UsageStore {
  const there = store.folders[folder] ?? { since: now, skills: {} }
  const use = there.skills[id] ?? { claude: 0, you: 0, last: 0 }
  const bumped: UseCount = { ...use, [who]: use[who] + 1, last: now }

  return capped({
    version: 1,
    folders: { ...store.folders, [folder]: { since: there.since, skills: { ...there.skills, [id]: bumped } } },
  })
}

/** What the Skills page shows for one folder. */
export function usageView(
  store: UsageStore,
  folder: string,
  now: number,
  options: { isTracking: boolean; unusedDays: number },
): UsageView {
  const everywhere: Record<string, number> = {}
  for (const one of Object.values(store.folders)) {
    for (const [id, use] of Object.entries(one.skills)) everywhere[id] = (everywhere[id] ?? 0) + use.claude + use.you
  }
  const there = store.folders[folder]

  return {
    isTracking: options.isTracking,
    since: there === undefined || there.since === 0 ? null : there.since,
    here: there?.skills ?? {},
    everywhere,
    now,
    unusedDays: options.unusedDays,
  }
}

/** A row's chip: `used 5× · 2 days ago`. */
export function usedChip(use: UseCount, now: number): string {
  return `used ${use.claude + use.you}× · ${ago(now - use.last)}`
}

/** The details line: `Here: 5 (Claude 3, you 2), last 2 days ago · All folders: 12`. */
export function usedLine(use: UseCount | undefined, everywhere: number, now: number): string {
  const here =
    use === undefined
      ? 'Not used here yet'
      : `Here: ${use.claude + use.you} (Claude ${use.claude}, you ${use.you}), last ${ago(now - use.last)}`

  return `${here} · All folders: ${everywhere}`
}
