// The panel's own store: everything it remembers between sessions. It stays
// on this computer. These functions take `$` but keep no state.
//
// Keys: `journal` (every change, for Undo), `profiles`, `usage`, `folders`,
// `rule-dismissed`, `topics`, `prefs`, `welcome-shown`, and per session
// `session-off:<id>` and `focus:<id>`.
import type { EngineInterface } from 'claude-code'

import type { Focus, GroupBy, JournalEntry, Profiles } from '../types'
import { readFolders } from './folders'
import type { FoldersStore } from './folders'
import { nextAt, readJournal, trimJournal } from './history'
import { cleanTopic, isRecord } from './lib'
import { readProfiles } from './profiles'
import { readUsage } from './usage'
import type { UsageStore } from './usage'

type Engine = EngineInterface

const JOURNAL = 'journal'
const PROFILES = 'profiles'
const USAGE = 'usage'
const FOLDERS = 'folders'
const DISMISSED = 'rule-dismissed'
const TOPICS = 'topics'
const PREFS = 'prefs'
const WELCOME = 'welcome-shown'
const SESSION_PREFIX = 'session-off:'
const FOCUS_PREFIX = 'focus:'
/** A session's switches and focus are forgotten this long after it last changed them. */
const SESSION_KEEP_MS = 45 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------- journal

export async function loadJournal($: Engine): Promise<JournalEntry[]> {
  return readJournal(await $.store.get(JOURNAL).catch(() => undefined))
}

export async function saveJournal($: Engine, entries: readonly JournalEntry[]): Promise<void> {
  await $.store.set(JOURNAL, trimJournal(entries))
}

/** Adds one change to the journal, at a time no other entry has. */
export async function remember($: Engine, entry: Omit<JournalEntry, 'at'>): Promise<void> {
  const journal = await loadJournal($)
  journal.push({ ...entry, at: nextAt(journal, await $.clock.now()) })
  try {
    await saveJournal($, journal)
  } catch {
    // The store is full: keep the newest fifth, so Undo still has this change.
    await $.store.set(JOURNAL, journal.slice(-Math.max(1, Math.floor(journal.length / 5))))
  }
}

// ---------------------------------------------------------------- profiles

export async function loadProfiles($: Engine): Promise<Profiles> {
  return readProfiles(await $.store.get(PROFILES).catch(() => undefined))
}

export async function saveProfiles($: Engine, value: Profiles): Promise<void> {
  await $.store.set(PROFILES, { version: 1, items: value.items, deleted: value.deleted })
}

// ---------------------------------------------------------------- usage

export async function loadUsage($: Engine): Promise<UsageStore> {
  return readUsage(await $.store.get(USAGE).catch(() => undefined))
}

export async function saveUsage($: Engine, value: UsageStore): Promise<void> {
  await $.store.set(USAGE, value)
}

// ---------------------------------------------------------------- folders

export async function loadFolders($: Engine): Promise<FoldersStore> {
  return readFolders(await $.store.get(FOLDERS).catch(() => undefined))
}

export async function saveFolders($: Engine, value: FoldersStore): Promise<void> {
  await $.store.set(FOLDERS, value)
}

// ---------------------------------------------------------------- folder rules: "Never here"

export async function loadDismissed($: Engine): Promise<Record<string, true>> {
  const raw = await $.store.get(DISMISSED).catch(() => undefined)
  const out: Record<string, true> = {}
  if (isRecord(raw)) for (const [pair, value] of Object.entries(raw)) if (value === true) out[pair] = true

  return out
}

export async function saveDismissed($: Engine, value: Readonly<Record<string, true>>): Promise<void> {
  await $.store.set(DISMISSED, value)
}

// ---------------------------------------------------------------- this session's switches and focus

export async function loadSessionOff($: Engine, sessionId: string): Promise<string[]> {
  const saved = await $.store.get(`${SESSION_PREFIX}${sessionId}`).catch(() => undefined)

  return isRecord(saved) && Array.isArray(saved['ids'])
    ? saved['ids'].filter((id): id is string => typeof id === 'string')
    : []
}

export async function saveSessionOff($: Engine, sessionId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) await $.store.delete(`${SESSION_PREFIX}${sessionId}`)
  else await $.store.set(`${SESSION_PREFIX}${sessionId}`, { at: await $.clock.now(), ids })
}

export async function loadFocus($: Engine, sessionId: string): Promise<Focus> {
  const saved = await $.store.get(`${FOCUS_PREFIX}${sessionId}`).catch(() => undefined)
  if (!isRecord(saved) || typeof saved['label'] !== 'string' || !Array.isArray(saved['added'])) return null
  const topic = typeof saved['topic'] === 'string' ? { topic: saved['topic'] } : {}
  const profile = typeof saved['profileId'] === 'string' ? { profileId: saved['profileId'] } : {}

  return {
    ...topic,
    ...profile,
    label: saved['label'],
    added: saved['added'].filter((id): id is string => typeof id === 'string'),
    at: typeof saved['at'] === 'number' ? saved['at'] : 0,
  }
}

export async function saveFocus($: Engine, sessionId: string, value: Focus): Promise<void> {
  if (value === null) await $.store.delete(`${FOCUS_PREFIX}${sessionId}`)
  else await $.store.set(`${FOCUS_PREFIX}${sessionId}`, value)
}

/** Forgets the switches and focus of sessions that ended long ago. */
export async function pruneSessions($: Engine, sessionId: string): Promise<void> {
  const now = await $.clock.now()
  for (const key of await $.store.keys().catch((): string[] => [])) {
    const isOurs = key.startsWith(SESSION_PREFIX) || key.startsWith(FOCUS_PREFIX)
    if (!isOurs || key === `${SESSION_PREFIX}${sessionId}` || key === `${FOCUS_PREFIX}${sessionId}`) continue
    const value = await $.store.get(key).catch(() => undefined)
    const at = isRecord(value) && typeof value['at'] === 'number' ? value['at'] : 0
    if (now - at > SESSION_KEEP_MS) await $.store.delete(key)
  }
}

// ---------------------------------------------------------------- topics, grouping, the first-time panel

export async function loadTopics($: Engine): Promise<Record<string, string> | null> {
  const saved = await $.store.get(TOPICS).catch(() => undefined)
  if (!isRecord(saved)) return null
  const picked: Record<string, string> = {}
  for (const [id, name] of Object.entries(saved)) {
    if (typeof name === 'string' && cleanTopic(name) !== '') picked[id] = cleanTopic(name)
  }

  return picked
}

export async function saveTopics($: Engine, picked: Readonly<Record<string, string>>): Promise<void> {
  await $.store.set(TOPICS, picked).catch(() => undefined)
}

export async function loadGroupBy($: Engine): Promise<GroupBy | null> {
  const prefs = await $.store.get(PREFS).catch(() => undefined)
  const stored = isRecord(prefs) ? prefs['groupBy'] : undefined

  return stored === 'topic' || stored === 'source' ? stored : null
}

export async function saveGroupBy($: Engine, groupBy: GroupBy): Promise<void> {
  await $.store.set(PREFS, { groupBy }).catch(() => undefined)
}

/** True until the panel has shown itself once on a surface. */
export async function isFirstTime($: Engine): Promise<boolean> {
  return (await $.store.get(WELCOME).catch(() => true)) === undefined
}

export async function markWelcomed($: Engine): Promise<void> {
  await $.store.set(WELCOME, true)
}

export async function clearUsageData($: Engine): Promise<void> {
  await $.store.delete(USAGE)
}
