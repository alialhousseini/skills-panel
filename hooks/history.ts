// The journal of changes: what the History page lists, and which entries can
// still be undone. No `$`.
import type { HistoryRow, HistoryScope, HistoryView, JournalEntry } from '../types'
import { ago, baseName, folderKey, isRecord, samePath } from './lib'

/** How many changes are kept. */
export const JOURNAL_MAX = 500
/** How many single switches they may hold together, so the store stays small. */
export const JOURNAL_MAX_OPS = 12_000
/** How many the History page lists. */
export const HISTORY_ROWS = 50

/** The stored journal, with anything that is not an entry left out. */
export function readJournal(raw: unknown): JournalEntry[] {
  if (!Array.isArray(raw)) return []

  return raw.filter(
    (entry): entry is JournalEntry =>
      isRecord(entry) &&
      typeof entry['at'] === 'number' &&
      typeof entry['label'] === 'string' &&
      (entry['scope'] === 'project' || entry['scope'] === 'session') &&
      Array.isArray(entry['ops']),
  )
}

/** The newest entries that fit: at most JOURNAL_MAX of them and JOURNAL_MAX_OPS switches. */
export function trimJournal(entries: readonly JournalEntry[]): JournalEntry[] {
  let from = Math.max(0, entries.length - JOURNAL_MAX)
  let ops = 0
  for (let i = from; i < entries.length; i++) ops += entries[i]?.ops.length ?? 0
  while (from < entries.length - 1 && ops > JOURNAL_MAX_OPS) {
    ops -= entries[from]?.ops.length ?? 0
    from++
  }

  return entries.slice(from)
}

/** A time no entry has yet: now, or just after the newest entry. */
export function nextAt(entries: readonly JournalEntry[], now: number): number {
  const newest = entries.reduce((max, entry) => Math.max(max, entry.at), 0)

  return Math.max(now, newest + 1)
}

/** What an entry touched: each skill or plugin, in its file or its session. */
function touched(entry: JournalEntry): string[] {
  const place = entry.scope === 'session' ? `session ${entry.sessionId}` : `file ${folderKey(entry.file)}`

  return entry.ops.map(op => `${place} ${op.kind === 'plugin' ? 'plugin' : 'skill'} ${op.id}`)
}

/**
 * Whether each entry can be undone now. An entry is `later` when a newer one
 * touched the same skill or plugin in the same file (or the same session):
 * undoing it would put back a value the newer change has replaced. Another
 * session's entries are `away`.
 */
export function undoStates(journal: readonly JournalEntry[], sessionId: string): HistoryRow['state'][] {
  const newer = new Set<string>()
  const states: HistoryRow['state'][] = []
  for (let i = journal.length - 1; i >= 0; i--) {
    const entry = journal[i]
    if (entry === undefined) continue
    const keys = touched(entry)
    states[i] =
      entry.scope === 'session' && entry.sessionId !== sessionId
        ? 'away'
        : keys.some(key => newer.has(key))
          ? 'later'
          : 'undo'
    for (const key of keys) newer.add(key)
  }

  return states
}

/** The newest entry the Skills page's Undo button takes back: this folder's, or this session's. */
export function lastUndoable(
  journal: readonly JournalEntry[],
  root: string,
  sessionId: string,
  withSession: boolean,
): number {
  for (let i = journal.length - 1; i >= 0; i--) {
    const entry = journal[i]
    if (entry === undefined) continue
    if (entry.scope === 'session' ? withSession && entry.sessionId === sessionId : samePath(entry.root, root)) return i
  }

  return -1
}

/** A label without its scope: `"alpha" off (this project)` reads `"alpha" off`. */
export function whatOf(label: string): string {
  return label.replace(/ \(this (project|session)\)$/, '')
}

/** The History page's rows: the newest changes the filter lets through. */
export function historyRows(
  journal: readonly JournalEntry[],
  want: { scope: HistoryScope; root: string; sessionId: string; now: number },
): HistoryView {
  const states = undoStates(journal, want.sessionId)
  const rows: HistoryRow[] = []
  let total = 0
  for (let i = journal.length - 1; i >= 0; i--) {
    const entry = journal[i]
    if (entry === undefined) continue
    const isMine = entry.scope === 'session' && entry.sessionId === want.sessionId
    const isHere = entry.scope === 'project' && samePath(entry.root, want.root)
    if (want.scope === 'folder' ? !isHere : want.scope === 'chat' ? !isMine : false) continue
    total++
    if (rows.length >= HISTORY_ROWS) continue
    rows.push({
      at: entry.at,
      ago: ago(want.now - entry.at),
      what: whatOf(entry.label),
      where:
        entry.scope === 'session'
          ? isMine
            ? 'this chat'
            : 'another chat'
          : want.scope === 'all'
            ? baseName(entry.root)
            : 'this project',
      state: states[i] ?? 'later',
    })
  }

  return { rows, total, scope: want.scope }
}

/** The panel's newest change in each folder, by folder key. */
export function lastChanges(journal: readonly JournalEntry[]): Map<string, number> {
  const last = new Map<string, number>()
  for (const entry of journal) {
    if (entry.scope !== 'project') continue
    const key = folderKey(entry.root)
    if ((last.get(key) ?? 0) < entry.at) last.set(key, entry.at)
  }

  return last
}
