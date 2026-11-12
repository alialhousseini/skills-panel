// The Projects page's list of folders: where it comes from and how it is
// cleaned. No `$`.
import { folderKey, isRecord } from './lib'

export type FolderSeen = { path: string; at: number }

/** The panel's own record: folders it saw a session start in, and the ones hidden from the list. */
export type FoldersStore = { version: 1; seen: Record<string, FolderSeen>; hidden: string[] }

/** How many seen folders are remembered. */
export const SEEN_MAX = 300
/** How many folders the Projects page looks at. */
export const FOLDERS_MAX = 60
/** How many it lists before "Show all". */
export const FOLDERS_FIRST = 8

/** The stored record, with anything that is not a folder left out. */
export function readFolders(raw: unknown): FoldersStore {
  const out: FoldersStore = { version: 1, seen: {}, hidden: [] }
  if (!isRecord(raw) || raw['version'] !== 1) return out
  if (isRecord(raw['seen'])) {
    for (const [key, one] of Object.entries(raw['seen'])) {
      if (isRecord(one) && typeof one['path'] === 'string' && one['path'] !== '') {
        out.seen[key] = { path: one['path'], at: typeof one['at'] === 'number' ? one['at'] : 0 }
      }
    }
  }
  if (Array.isArray(raw['hidden'])) out.hidden = raw['hidden'].filter((key): key is string => typeof key === 'string')

  return out
}

/** The record with one more folder seen now; the oldest go once there are too many. */
export function withSeen(store: FoldersStore, path: string, now: number): FoldersStore {
  const seen = { ...store.seen, [folderKey(path)]: { path, at: now } }
  const keys = Object.keys(seen)
  if (keys.length > SEEN_MAX) {
    const oldest = keys.sort((a, b) => (seen[a]?.at ?? 0) - (seen[b]?.at ?? 0)).slice(0, keys.length - SEEN_MAX)
    for (const key of oldest) delete seen[key]
  }

  return { ...store, seen }
}

/** A folder on this computer, by an absolute path: not an `ssh:` remote, not a network share. */
export function isLocalPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\/(?!\/)/.test(path)
}

/** Folder names that mark a worktree, a temp folder or a scratch folder, wherever they sit. */
const NOISE_INSIDE = ['/.claude/worktrees/', '/appdata/local/temp/', '/scratch-workspaces/']
/** The system's temp folders. */
const NOISE_ROOTS = ['/tmp/', '/private/tmp/', '/var/tmp/', '/var/folders/', '/private/var/folders/']

/** A folder nobody means to manage: the home folder, a worktree, a temp or scratch folder. */
export function isNoise(key: string, homeKey: string): boolean {
  const padded = `${key}/`

  return (
    key === homeKey ||
    key === '' ||
    NOISE_INSIDE.some(part => padded.includes(part)) ||
    NOISE_ROOTS.some(part => padded.startsWith(part))
  )
}

export type Candidate = { key: string; path: string; at: number }

/**
 * The folders worth listing, most recently used first. `seen` is the panel's
 * own record; `listed` are folder paths from Claude Code's own list, oldest
 * first, which carry no time; `changed` is the panel's last change per folder.
 * Case and slash variants of one folder are one folder.
 */
export function candidates(
  seen: Readonly<Record<string, FolderSeen>>,
  listed: readonly string[],
  changed: ReadonlyMap<string, number>,
  homeKey: string,
): Candidate[] {
  const found = new Map<string, Candidate & { order: number }>()
  const add = (path: string, at: number, order: number) => {
    if (!isLocalPath(path)) return
    const key = folderKey(path)
    if (isNoise(key, homeKey)) return
    const known = found.get(key)
    if (known === undefined) found.set(key, { key, path, at: Math.max(at, changed.get(key) ?? 0), order })
    else if (at > known.at) known.at = at
  }
  // The panel's own record first: it has the path as the session really spelled it.
  for (const one of Object.values(seen)) add(one.path, one.at, listed.length)
  listed.forEach((path, index) => add(path, 0, index))

  return [...found.values()]
    .sort((a, b) => b.at - a.at || b.order - a.order || a.key.localeCompare(b.key))
    .map(({ key, path, at }) => ({ key, path, at }))
}

/** A path with the home folder written `~`. */
export function tilde(path: string, home: string): string {
  if (home === '') return path
  const key = folderKey(path)
  const homeKey = folderKey(home)
  if (key === homeKey) return '~'

  return key.startsWith(`${homeKey}/`) ? `~${path.slice(home.replace(/[\\/]+$/, '').length)}` : path
}
