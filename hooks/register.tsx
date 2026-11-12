// Skills panel: switch skills on or off for one project or for one chat.
//
// This project: written to <project>/.claude/settings.local.json, the file the
// /skills menu writes too. Your and project skills use `skillOverrides`
// (on, name-only, user-invocable-only, off); plugin and app skills, which
// skillOverrides skips, use a `Skill(<plugin>:<skill>)` deny rule; a whole
// plugin uses `enabledPlugins`.
// This session: held by this mod only. The skill leaves Claude's skill list,
// a Skill call for it is refused, and `/name` is refused too.
//
// Four pages: Skills (the switches, and Focus for one chat), Profiles (saved
// setups, and the folders that suggest them), Projects (every folder, managed
// from here) and History (undo any change).
//
// Rules this file keeps:
// - Skill files are never edited, moved or deleted.
// - In a settings.local.json only skillOverrides, Skill(...) deny rules and
//   enabledPlugins are written. A file that is not valid JSON is left alone.
// - One journal entry per action, so Undo puts back exactly what was there.
// - Nothing changes by itself: suggestions wait for a press.
// - Nothing leaves this computer.
//
// This file holds the state and what each press does. The pages are drawn in
// page-*.tsx, the logic without `$` is in lib.ts and the files beside it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  Focus,
  FolderCard,
  FoldersView,
  GroupBy,
  HistoryScope,
  HistoryView,
  Inventory,
  Level,
  Op,
  Page,
  Profile,
  ProfileAct,
  Profiles,
  ProjectView,
  Scope,
  Show,
  SkillRow,
  Suggest,
  UsageView,
  View,
} from '../types'
import {
  buildInventory,
  claudeProjects,
  existing,
  folderStats,
  inventoryFor,
  keepOutOfGit,
  loadView,
  locate,
  lowerLayers,
  readLocal,
} from './disk'
import { FOLDERS_MAX, candidates, isLocalPath, isNoise, tilde, withSeen } from './folders'
import { historyRows, lastChanges, lastUndoable, undoStates } from './history'
import {
  DAY_MS,
  LEVEL_LABELS,
  LEVEL_TAGS,
  SETUP_TOPIC,
  allDenyRules,
  applyOps,
  autoTopic,
  baseName,
  cleanTopic,
  count,
  denies,
  enabledOf,
  filterListing,
  folderKey,
  groupRank,
  groupTitle,
  invert,
  isCallable,
  isRecord,
  levelOf,
  levelOp,
  noteFor,
  overrideOf,
  parentPath,
  samePath,
  shortCount,
  shortName,
  stringifySettings,
  topicOf,
  usesDeny,
} from './lib'
import type { FileOp, Layer } from './lib'
import { PANEL_RULE, buildModel, levelsNow, topicsWithSkills } from './model'
import type { Model } from './model'
import { historyPage } from './page-history'
import { profilesPage } from './page-profiles'
import { projectsPage } from './page-projects'
import { skillsPage } from './page-skills'
import {
  DELETED_KEEP,
  cleanName,
  matchRules,
  planProject,
  planSession,
  profileId,
  profileSummary,
  projectPlanText,
  rulePair,
  sessionPlanText,
  snapshotProject,
  snapshotSession,
} from './profiles'
import {
  clearUsageData,
  isFirstTime,
  loadDismissed,
  loadFocus,
  loadFolders,
  loadGroupBy,
  loadJournal,
  loadProfiles,
  loadSessionOff,
  loadTopics,
  loadUsage,
  markWelcomed,
  pruneSessions,
  remember,
  saveDismissed,
  saveFocus,
  saveFolders,
  saveGroupBy,
  saveJournal,
  saveProfiles,
  saveSessionOff,
  saveTopics,
  saveUsage,
} from './store'
import { tabs } from './ui'
import type { Act, Kit } from './ui'
import { began, counted, usageView } from './usage'
import type { UsageStore } from './usage'

type Engine = EngineInterface
/** A folder's skills, and what is on and off there. */
type Shown = { inv: Inventory; pv: ProjectView }

const PANE = 'skills-panel'
const TITLE = 'Skills'

/** The plugin's two options (`userConfig` in plugin.json), read when it loads. */
const OPTIONS = { trackUsage: true, unusedDays: 30 }
/** The suggestion line about unused skills shows from this many. */
const UNUSED_HINT_FROM = 10

const DEFAULT_VIEW: View = {
  page: 'skills',
  scope: 'project',
  filter: '',
  show: 'all',
  groupBy: 'topic',
  open: [],
  detail: null,
  act: null,
  history: null,
  copy: null,
  showHidden: false,
  allFolders: false,
  confirmClear: false,
}
const NO_PROFILES: Profiles = { items: [], deleted: [] }
const NO_HISTORY: HistoryView = { rows: [], total: 0, scope: 'folder' }
const NO_USAGE: UsageView = { isTracking: true, since: null, here: {}, everywhere: {}, now: 0, unusedDays: 30 }
const NO_FOLDERS: FoldersView = { cards: [], now: 0, isLoaded: false }
const NO_SUGGEST: Suggest = { offer: null, later: [], toasted: [], isPreview: false }

// Bump a shape tag whenever its value's shape changes: a reload keeps the old
// value, and the tag makes the new code read it as the initial one.
const inventory = atom({ plugin: 'skills-panel', key: 'inventory' } as const, null, { shape: 'inventory-3' })
const project = atom({ plugin: 'skills-panel', key: 'project' } as const, null, { shape: 'project-3' })
const other = atom({ plugin: 'skills-panel', key: 'other' } as const, null, { shape: 'other-1' })
const sessionOff = atom({ plugin: 'skills-panel', key: 'sessionOff' } as const, [], { shape: 'ids-1' })
const view = atom({ plugin: 'skills-panel', key: 'view' } as const, DEFAULT_VIEW, { shape: 'view-3' })
const notice = atom({ plugin: 'skills-panel', key: 'notice' } as const, null, { shape: 'notice-1' })
const pending = atom({ plugin: 'skills-panel', key: 'pending' } as const, {}, { shape: 'pending-1' })
const undoLabel = atom({ plugin: 'skills-panel', key: 'undoLabel' } as const, null, { shape: 'undo-1' })
const topics = atom({ plugin: 'skills-panel', key: 'topics' } as const, {}, { shape: 'topics-1' })
const profiles = atom({ plugin: 'skills-panel', key: 'profiles' } as const, NO_PROFILES, { shape: 'profiles-1' })
const focus = atom({ plugin: 'skills-panel', key: 'focus' } as const, null, { shape: 'focus-1' })
const history = atom({ plugin: 'skills-panel', key: 'history' } as const, NO_HISTORY, { shape: 'history-1' })
const usage = atom({ plugin: 'skills-panel', key: 'usage' } as const, NO_USAGE, { shape: 'usage-1' })
const folders = atom({ plugin: 'skills-panel', key: 'folders' } as const, NO_FOLDERS, { shape: 'folders-1' })
const suggest = atom({ plugin: 'skills-panel', key: 'suggest' } as const, NO_SUGGEST, { shape: 'suggest-1' })
const busy = atom({ plugin: 'skills-panel', key: 'busy' } as const, false)

// ---------------------------------------------------------------- what is shown

async function sessionIdOf($: Engine): Promise<string> {
  return $.session.id().catch(() => 'unknown')
}

async function say($: Engine, text: string, tone: 'ok' | 'warn' | 'error' = 'ok'): Promise<void> {
  await update($, notice, () => ({ text, tone }))
}

/** The folder this session runs in, once read. */
async function hereOf($: Engine): Promise<Shown | null> {
  const inv = await read($, inventory)
  const pv = await read($, project)

  return inv === null || pv === null ? null : { inv, pv }
}

/** The folder the Skills page shows: another one while it is managed, else this session's. */
async function shownOf($: Engine): Promise<Shown | null> {
  return (await read($, other)) ?? (await hereOf($))
}

async function modelOf($: Engine, shown: Shown | null, scope?: Scope): Promise<Model | null> {
  if (shown === null) return null
  const current = await read($, view)

  return buildModel(
    shown.inv,
    shown.pv,
    scope === undefined ? current : { ...current, scope },
    await read($, sessionOff),
    await read($, topics),
    await read($, usage),
  )
}

/** The Skills page as it stands: what a drawing and a press both read. */
async function currentModel($: Engine): Promise<Model | null> {
  return modelOf($, await shownOf($))
}

// ---------------------------------------------------------------- refreshing state

async function refreshAll($: Engine): Promise<void> {
  await update($, busy, () => true)
  try {
    const fresh = await loadView($, await buildInventory($), await read($, sessionOff))
    await update($, inventory, () => fresh.inv)
    await update($, project, () => fresh.pv)
    const there = await read($, other)
    if (there !== null) {
      const again = await loadView($, await inventoryFor($, fresh.inv, there.inv.root), [])
      await update($, other, () => again)
    }
    await showUsage($)
    await afterChange($)
  } catch (error) {
    await say($, `Could not read the skills: ${String(error)}`, 'error')
  } finally {
    await update($, busy, () => false)
  }
}

/** Reads again what is on and off, after a settings file changed. */
async function refreshProject($: Engine): Promise<void> {
  const here = await read($, inventory)
  if (here !== null) {
    const fresh = await loadView($, here, await read($, sessionOff))
    await update($, inventory, () => fresh.inv)
    await update($, project, () => fresh.pv)
  }
  const there = await read($, other)
  if (there !== null) {
    const fresh = await loadView($, there.inv, [])
    await update($, other, () => fresh)
  }
  await afterChange($)
}

/** What follows every change: the Undo line and the History rows, the suggestion, the status line. */
async function afterChange($: Engine): Promise<void> {
  await refreshHistory($)
  await refreshSuggest($)
  await showStatus($)
}

/** The status line under the prompt: the focus in force, or how many skills are off here, or nothing. */
async function showStatus($: Engine): Promise<void> {
  const here = await hereOf($)
  const offInSession = await read($, sessionOff)
  const focused = await read($, focus)
  if (focused !== null && here !== null) {
    const off = new Set([...here.pv.off, ...offInSession])
    const live = here.inv.skills.filter(row => !off.has(row.id)).length
    $.ui.status(`Focus: ${focused.label} · ${count(live, 'skill')} on (/skills-panel)`)

    return
  }
  let ids: string[]
  if (here !== null) {
    ids = [...here.pv.off, ...offInSession]
  } else {
    const merged = await $.settings.read().catch((): Readonly<Record<string, unknown>> => ({}))
    const overrides = merged['skillOverrides']
    const offIds = isRecord(overrides) ? Object.keys(overrides).filter(id => overrides[id] === 'off') : []
    const denied = allDenyRules([{ source: 'local', settings: merged }])
      .map(rule => PANEL_RULE.exec(rule)?.[1])
      .filter((id): id is string => id !== undefined)
    ids = [...offIds, ...denied, ...offInSession]
  }
  const off = new Set(ids).size
  $.ui.status(off > 0 ? `Skills off here: ${off} (/skills-panel)` : undefined)
}

// ---------------------------------------------------------------- history (Undo)

/** The History filter in force: the one picked, else the one that fits the Skills page's scope. */
function historyScopeOf(current: View, isOther: boolean): HistoryScope {
  return current.history ?? (current.scope === 'session' && !isOther ? 'chat' : 'folder')
}

async function refreshHistory($: Engine): Promise<void> {
  const journal = await loadJournal($)
  const sessionId = await sessionIdOf($)
  const shown = await shownOf($)
  const root = shown?.inv.root ?? ''
  const isOther = shown?.inv.isOther ?? false
  const last = journal[lastUndoable(journal, root, sessionId, !isOther)]
  await update($, undoLabel, () => last?.label ?? null)
  const scope = historyScopeOf(await read($, view), isOther)
  const rows = historyRows(journal, { scope, root, sessionId, now: await $.clock.now() })
  await update($, history, () => rows)
}

// ---------------------------------------------------------------- telling Claude

type Told = { row: SkillRow; isOn: boolean; level?: Level }

/** Claude hears of these with the next prompt. Only changes to this session matter to it. */
async function tellClaude($: Engine, scope: Scope, told: readonly Told[]): Promise<void> {
  if (told.length === 0) return
  await update($, pending, current => {
    const merged = { ...current }
    for (const { row, isOn, level } of told) {
      merged[`${scope}:${row.id}`] = {
        scope,
        id: row.id,
        isOn,
        description: row.description,
        ...(level === undefined ? {} : { level }),
      }
    }

    return merged
  })
}

// ---------------------------------------------------------------- switching: a folder's settings

async function writeProject(
  $: Engine,
  inv: Pick<Inventory, 'root' | 'file'>,
  ops: readonly FileOp[],
  label: string,
  done: string,
): Promise<FileOp[] | null> {
  const local = await readLocal($, inv.file)
  if ('error' in local) {
    await say($, `Nothing changed: ${inv.file} ${local.error}. Fix that file first.`, 'error')

    return null
  }
  let result: { updated: Record<string, unknown>; applied: FileOp[] }
  try {
    result = applyOps(local.value, ops)
  } catch (error) {
    await say($, `Nothing changed: in ${inv.file}, ${String(error)}.`, 'error')

    return null
  }
  if (result.applied.length === 0) {
    await say($, 'Already set that way.', 'warn')

    return null
  }
  const isNew = !(await $.fs.exists(inv.file).catch(() => true))
  await $.fs.write(inv.file, stringifySettings(result.updated))
  // A settings file the panel creates in a git repository is kept out of commits.
  const isExcluded = isNew && (await keepOutOfGit($, inv.root))
  await remember($, {
    scope: 'project',
    root: inv.root,
    file: inv.file,
    sessionId: await sessionIdOf($),
    label,
    ops: result.applied,
  })
  await refreshProject($)
  await say($, isExcluded ? `${done} The new settings file is kept out of git (added to .git/info/exclude).` : done)

  return result.applied
}

/** The level a skill goes back to when switched on: what the lower settings give, unless that is off. */
function onLevelFor(row: SkillRow, lower: readonly Layer[]): Level {
  if (usesDeny(row)) return 'on'
  const inherited = levelOf(overrideOf(lower, row.id).value)

  return inherited === 'off' ? 'on' : inherited
}

/** Writes levels for one folder, and tells Claude about them when it is this session's folder. */
async function applyLevels(
  $: Engine,
  shown: Shown,
  targets: readonly { row: SkillRow; level: Level }[],
  label: string,
  done: string,
): Promise<boolean> {
  if (targets.length === 0) {
    await say($, 'Already set that way.', 'warn')

    return false
  }
  const lower = await lowerLayers($, shown.inv)
  const before = levelsNow(shown.pv)
  const applied = await writeProject(
    $,
    shown.inv,
    targets.map(({ row, level }) => levelOp(row, level, lower)),
    label,
    done,
  )
  if (applied === null) return false
  if (!shown.inv.isOther) {
    const appliedIds = new Set(applied.map(op => op.id))
    await tellClaude(
      $,
      'project',
      targets
        .filter(({ row, level }) => appliedIds.has(row.id) && isCallable(before(row.id)) !== isCallable(level))
        .map(({ row, level }) => ({ row, isOn: level !== 'off', level })),
    )
  }

  return true
}

// ---------------------------------------------------------------- switching: this session

/** The focus without the ids a hand-made change just touched: those are the user's own now. */
function forget(focused: Focus, ids: readonly string[]): Focus {
  if (focused === null || !focused.added.some(id => ids.includes(id))) return focused

  return { ...focused, added: focused.added.filter(id => !ids.includes(id)) }
}

async function putFocus($: Engine, value: Focus): Promise<void> {
  await update($, focus, () => value)
  await saveFocus($, await sessionIdOf($), value).catch(() => undefined)
}

/**
 * One change to this session's switches: one journal entry, one note to
 * Claude. `focusAfter` is the focus the change leaves in force; left out, the
 * change is made by hand and the focus only forgets the ids it touched.
 */
async function changeSession(
  $: Engine,
  change: { off: readonly string[]; back: readonly string[] },
  label: string,
  done: string,
  focusAfter?: Focus,
): Promise<boolean> {
  const here = await read($, inventory)
  if (here === null) return false
  const before = new Set(await read($, sessionOff))
  const off = [...new Set(change.off)].filter(id => !before.has(id))
  const back = [...new Set(change.back)].filter(id => before.has(id) && !off.includes(id))
  const focusBefore = await read($, focus)
  const focusNow = focusAfter === undefined ? forget(focusBefore, [...off, ...back]) : focusAfter
  const isFocusChange = JSON.stringify(focusBefore) !== JSON.stringify(focusNow)
  if (off.length === 0 && back.length === 0 && !isFocusChange) {
    await say($, 'Already set that way.', 'warn')

    return false
  }
  const backSet = new Set(back)
  await update($, sessionOff, current => [...new Set([...current.filter(id => !backSet.has(id)), ...off])])
  const sessionId = await sessionIdOf($)
  await saveSessionOff($, sessionId, await read($, sessionOff))
  if (isFocusChange) await putFocus($, focusNow)
  const ops: Op[] = [
    ...off.map((id): Op => ({ kind: 'session', id, before: false, after: true })),
    ...back.map((id): Op => ({ kind: 'session', id, before: true, after: false })),
  ]
  await remember($, {
    scope: 'session',
    root: here.root,
    file: '',
    sessionId,
    label,
    ops,
    ...(isFocusChange ? { focus: { before: focusBefore, after: focusNow } } : {}),
  })
  const offSet = new Set(off)
  await tellClaude($, 'session', [
    ...here.skills.filter(row => offSet.has(row.id)).map(row => ({ row, isOn: false })),
    ...here.skills.filter(row => backSet.has(row.id)).map(row => ({ row, isOn: true })),
  ])
  await afterChange($)
  await say($, done)

  return true
}

// ---------------------------------------------------------------- switching: what the Skills page's presses do

/** Switches rows on or off in the scope picked; `what` names them in the Undo line and the notice. */
async function switchRows($: Engine, m: Model, rows: readonly SkillRow[], turnOn: boolean, what: string, said: string) {
  const word = turnOn ? 'on' : 'off'
  const loud = turnOn ? 'ON' : 'OFF'
  if (m.isSession) {
    const ids = rows.filter(row => m.lockOf(row) === null && m.offInSession.has(row.id) === turnOn).map(row => row.id)
    await changeSession(
      $,
      turnOn ? { off: [], back: ids } : { off: ids, back: [] },
      `${what} ${word} (this session)`,
      `${said} ${loud} for this session.`,
    )

    return
  }
  const targets = rows.filter(row => m.lockOf(row) === null && m.isOn(row) !== turnOn)
  const lower = turnOn ? await lowerLayers($, m.inv) : []
  await applyLevels(
    $,
    m,
    targets.map(row => ({ row, level: turnOn ? onLevelFor(row, lower) : 'off' })),
    `${what} ${word} (this project)`,
    `${said} ${loud} for ${m.isOther ? m.inv.project : 'this project'}.`,
  )
}

/** Flips one skill, from what it shows when pressed. */
async function switchOne($: Engine, id: string) {
  const m = await currentModel($)
  const row = m?.inv.skills.find(skill => skill.id === id)
  if (m === null || row === undefined) return
  await switchRows($, m, [row], !m.isOn(row), `"${row.id}"`, `"${shortName(row)}" is`)
}

/** A group's switch: all of its shown rows on, or all off when they are all on already. */
async function switchGroup($: Engine, key: string) {
  const m = await currentModel($)
  const group = m?.groups.find(one => one.key === key)
  if (m === null || group === undefined) return
  const rows = group.shown.filter(row => m.lockOf(row) === null)
  const turnOn = !rows.every(m.isOn)
  const changed = rows.filter(row => m.isOn(row) !== turnOn).length
  await switchRows($, m, rows, turnOn, `${changed} in "${group.title}"`, `${changed} skills in "${group.title}" are`)
}

async function switchPlugin($: Engine, pluginId: string) {
  const m = await currentModel($)
  if (m === null) return
  const turnOn = !(m.pv.plugins.find(plugin => plugin.id === pluginId)?.isOn ?? false)
  const lower = enabledOf(await lowerLayers($, m.inv), pluginId)
  const name = pluginId.split('@')[0] ?? pluginId
  const where = m.isOther ? m.inv.project : 'this project'
  await writeProject(
    $,
    m.inv,
    [{ kind: 'plugin', id: pluginId, before: null, after: lower.value === turnOn ? null : turnOn }],
    `plugin "${name}" ${turnOn ? 'on' : 'off'} (this project)`,
    turnOn
      ? `Plugin "${name}" is ON for ${where}. Start a new session there to load it.`
      : `Plugin "${name}" is OFF for ${where}, from the next new session there.`,
  )
}

/** The details dropdown: one level for the folder. */
async function setLevel($: Engine, id: string, level: Level) {
  const m = await currentModel($)
  const row = m?.inv.skills.find(skill => skill.id === id)
  if (m === null || row === undefined || m.lockOf(row) !== null) return
  if (m.levelNow(row) === level) {
    await say($, 'Already set that way.', 'warn')

    return
  }
  await applyLevels(
    $,
    m,
    [{ row, level }],
    `"${row.id}" set to ${LEVEL_TAGS[level] ?? level} (this project)`,
    `"${shortName(row)}" for ${m.isOther ? m.inv.project : 'this project'}: ${LEVEL_LABELS[level]}.`,
  )
}

/** Every change the list shows as Changed, put back to the default (one Undo brings it all back). */
async function resetChanged($: Engine) {
  const m = await currentModel($)
  if (m === null) return
  const rows = m.inv.skills.filter(row => m.changed.has(row.id) && m.lockOf(row) === null)
  if (m.isSession) {
    await changeSession(
      $,
      { off: [], back: rows.map(row => row.id) },
      `${rows.length} back on (this session)`,
      `${rows.length} skills are back on for this session.`,
    )

    return
  }
  const lower = await lowerLayers($, m.inv)
  await applyLevels(
    $,
    m,
    rows.map(row => ({ row, level: usesDeny(row) ? 'on' : levelOf(overrideOf(lower, row.id).value) })),
    `${rows.length} back to default (this project)`,
    `${rows.length} skills are back to their default for ${m.isOther ? m.inv.project : 'this project'}.`,
  )
}

// ---------------------------------------------------------------- Undo: the last change, or any one

/** Takes back the journal entry made at `at`, when no newer change stands in its way. */
async function undoEntry($: Engine, at: number): Promise<void> {
  const journal = await loadJournal($)
  const index = journal.findIndex(one => one.at === at)
  const entry = journal[index]
  const sessionId = await sessionIdOf($)
  if (entry === undefined) {
    await refreshHistory($)
    await say($, 'That change is no longer in the history.', 'warn')

    return
  }
  const state = undoStates(journal, sessionId)[index]
  if (state !== 'undo') {
    await say(
      $,
      state === 'away'
        ? 'That change belongs to another chat: undo it there.'
        : 'A newer change touched the same skill. Undo that one first.',
      'warn',
    )

    return
  }
  const back = [...entry.ops].reverse().map(invert)

  if (entry.scope === 'project') {
    const local = await readLocal($, entry.file)
    if ('error' in local) {
      await say($, `Could not undo: ${entry.file} ${local.error}.`, 'error')

      return
    }
    try {
      const fileOps = back.filter((op): op is FileOp => op.kind !== 'session')
      const result = applyOps(local.value, fileOps)
      // Nothing to put back (the file was reset by hand, say): the entry just goes, and no file is made.
      if (result.applied.length > 0) await $.fs.write(entry.file, stringifySettings(result.updated))
    } catch (error) {
      await say($, `Could not undo: ${String(error)}.`, 'error')

      return
    }
  } else {
    await update($, sessionOff, current => {
      let ids = [...current]
      for (const op of back) {
        if (op.kind !== 'session') continue
        ids = op.after ? [...new Set([...ids, op.id])] : ids.filter(id => id !== op.id)
      }

      return ids
    })
    await saveSessionOff($, sessionId, await read($, sessionOff))
    if (entry.focus !== undefined) await putFocus($, entry.focus.before)
  }

  journal.splice(index, 1)
  await saveJournal($, journal)

  // Claude hears of it when it changes this session: its own switches, or its folder's settings.
  const here = await read($, inventory)
  if (here !== null && (entry.scope === 'session' || samePath(entry.root, here.root))) {
    const byId = new Map(here.skills.map(row => [row.id, row]))
    const told: Told[] = []
    for (const op of back) {
      const row = byId.get(op.id)
      if (op.kind === 'plugin' || row === undefined) continue
      if (op.kind === 'override') {
        const level = levelOf(op.after ?? undefined)
        told.push({ row, isOn: level !== 'off', level })
      } else {
        told.push({ row, isOn: !op.after })
      }
    }
    await tellClaude($, entry.scope, told)
  }
  await refreshProject($)
  if ((await read($, folders)).isLoaded) await refreshFolders($)
  await say($, `Undone: ${entry.label}.`)
}

/** The Skills page's Undo: the newest change to the folder shown, or to this session. */
async function undoLast($: Engine) {
  const shown = await shownOf($)
  if (shown === null) return
  const journal = await loadJournal($)
  const entry = journal[lastUndoable(journal, shown.inv.root, await sessionIdOf($), !shown.inv.isOther)]
  if (entry === undefined) {
    await say($, 'Nothing to undo here.', 'warn')

    return
  }
  await undoEntry($, entry.at)
}

// ---------------------------------------------------------------- the panel's own view

async function setPage($: Engine, page: Page) {
  await update($, view, (current): View => ({ ...current, page, act: null, copy: null, confirmClear: false }))
  await update($, notice, () => null)
  if (page === 'history') await refreshHistory($)
  if (page === 'skills') await showUsage($)
  if (page === 'profiles') {
    const saved = await loadProfiles($)
    await update($, profiles, () => saved)
  }
  if (page === 'profiles' || page === 'projects') await refreshFolders($)
}

async function setScope($: Engine, scope: Scope) {
  await update($, view, (current): View => ({ ...current, scope, act: null }))
  await refreshHistory($)
}

async function setFilter($: Engine, filter: string) {
  await update($, view, current => ({ ...current, filter }))
}

async function setShow($: Engine, show: Show) {
  await update($, view, current => ({ ...current, show }))
}

async function setGroupBy($: Engine, groupBy: GroupBy) {
  await update($, view, current => ({ ...current, groupBy }))
  await saveGroupBy($, groupBy)
}

async function toggleOpen($: Engine, group: string) {
  await update($, view, current => ({
    ...current,
    open: current.open.includes(group) ? current.open.filter(key => key !== group) : [...current.open, group],
  }))
}

async function toggleDetail($: Engine, id: string) {
  await update($, view, current => ({ ...current, detail: current.detail === id ? null : id }))
}

async function clearFilters($: Engine) {
  await update($, view, (current): View => ({ ...current, filter: '', show: 'all' }))
}

async function setHistoryScope($: Engine, scope: HistoryScope) {
  await update($, view, (current): View => ({ ...current, history: scope }))
  await refreshHistory($)
}

/** A topic the user picked for one skill, kept for every project; null sorts it automatically again. */
async function setTopic($: Engine, row: SkillRow, topic: string | null) {
  const name = topic === null ? '' : cleanTopic(topic)
  const isAuto = name === '' || name === autoTopic(row)
  await update($, topics, current => {
    const merged = { ...current }
    if (isAuto) delete merged[row.id]
    else merged[row.id] = name

    return merged
  })
  await saveTopics($, await read($, topics))
  // Open the group it moved to, so the skill (and its details) stay in view.
  const landed = `topic:${isAuto ? autoTopic(row) : name}`
  await update($, view, current => (current.open.includes(landed) ? current : { ...current, open: [...current.open, landed] }))
  await say($, isAuto ? `"${shortName(row)}" is sorted by itself again.` : `"${shortName(row)}" is now under "${name}".`)
}

async function openPane($: Engine): Promise<{ isPlaced: boolean; reason?: string }> {
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: 64 })

  return opened.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: opened.reason }
}

/** A plain-text summary of what is on and off, for the model's open_panel tool. */
async function summary($: Engine, opened: { isPlaced: boolean; reason?: string }): Promise<string> {
  const here = await hereOf($)
  if (here === null) return 'The Skills panel could not read the skills.'
  const { inv, pv } = here
  const offInSession = new Set(await read($, sessionOff))
  const projectOff = new Set(pv.off)
  const groups = [...new Set(inv.skills.map(row => row.group))]
    .sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b))
    .map(group => {
      const rows = inv.skills.filter(row => row.group === group)
      const onCount = rows.filter(row => !projectOff.has(row.id) && !offInSession.has(row.id)).length

      return `- ${groupTitle(group)}: ${onCount}/${rows.length} on`
    })
  const pluginsOff = pv.plugins.filter(plugin => !plugin.isOn).map(plugin => plugin.id)
  const budget = inv.budget
  const focused = await read($, focus)

  return [
    opened.isPlaced
      ? 'The Skills panel is open beside the chat.'
      : `The Skills panel is ready but not shown (${opened.reason ?? 'no room'}); /skills-panel opens it.`,
    `Project: ${inv.project} (${inv.root})`,
    `${inv.skills.length} skills. Off for this project: ${projectOff.size}. Off for this session only: ${offInSession.size}.`,
    focused === null ? '' : `This chat is focused on ${focused.label}.`,
    ...groups,
    pluginsOff.length > 0 ? `Plugins off here: ${pluginsOff.join(', ')}` : 'Every installed plugin is on here.',
    budget !== null
      ? `Claude's skill list: about ${shortCount(budget.tokens)} tokens; ${budget.included} of ${budget.total} skills fit in it.`
      : '',
    pv.fileError !== null ? `Problem: ${pv.fileError}` : '',
  ]
    .filter(line => line !== '')
    .join('\n')
}

// ---------------------------------------------------------------- profiles

/** Changes the stored profiles (read fresh, so another session's changes are kept) and shows the result. */
async function changeProfiles($: Engine, change: (value: Profiles) => Profiles): Promise<Profiles> {
  const changed = change(await loadProfiles($))
  await saveProfiles($, changed)
  await update($, profiles, () => changed)

  return changed
}

/** What a profile would keep right now: the folder's setup, or this session's. */
function setupOf(m: Model): Pick<Profile, 'off' | 'levels'> {
  return m.isSession ? snapshotSession(m.inv.skills, m.projectOff, m.offInSession) : snapshotProject(m.pv, m.inv.skills)
}

async function closeStep($: Engine) {
  await update($, view, (current): View => ({ ...current, act: null }))
  await update($, suggest, current => (current.isPreview ? { ...current, isPreview: false } : current))
}

async function saveProfile($: Engine, text: string) {
  const name = cleanName(text)
  const m = await currentModel($)
  if (m === null) return
  if (name === '') {
    await say($, 'Type a name first, then press Enter.', 'warn')

    return
  }
  const saved = await loadProfiles($)
  if (saved.items.some(one => one.name.toLowerCase() === name.toLowerCase())) {
    await say($, `"${name}" already exists. Press Update on it, or pick another name.`, 'warn')

    return
  }
  const now = await $.clock.now()
  const taken = new Set([...saved.items, ...saved.deleted].map(one => one.id))
  const made: Profile = { id: profileId(name, taken), name, ...setupOf(m), folders: [], createdAt: now, updatedAt: now }
  await changeProfiles($, value => ({ ...value, items: [...value.items, made] }))
  await closeStep($)
  await say($, `Saved "${name}": ${profileSummary(made)}.`)
}

async function updateProfile($: Engine, id: string) {
  const m = await currentModel($)
  if (m === null) return
  const setup = setupOf(m)
  const now = await $.clock.now()
  const after = await changeProfiles($, value => ({
    ...value,
    items: value.items.map(one => (one.id === id ? { ...one, ...setup, updatedAt: now } : one)),
  }))
  const profile = after.items.find(one => one.id === id)
  await closeStep($)
  if (profile !== undefined) await say($, `"${profile.name}" now holds this setup: ${profileSummary(profile)}.`)
  await refreshSuggest($)
}

async function renameProfile($: Engine, id: string, text: string) {
  const name = cleanName(text)
  const saved = await loadProfiles($)
  if (name === '') {
    await say($, 'Type the new name, then press Enter.', 'warn')

    return
  }
  if (saved.items.some(one => one.id !== id && one.name.toLowerCase() === name.toLowerCase())) {
    await say($, `Another profile is already called "${name}".`, 'warn')

    return
  }
  const now = await $.clock.now()
  await changeProfiles($, value => ({
    ...value,
    items: value.items.map(one => (one.id === id ? { ...one, name, updatedAt: now } : one)),
  }))
  await closeStep($)
  await say($, `Renamed to "${name}".`)
  await refreshSuggest($)
}

async function deleteProfile($: Engine, id: string) {
  let gone: Profile | undefined
  await changeProfiles($, value => {
    gone = value.items.find(one => one.id === id)
    if (gone === undefined) return value

    return {
      items: value.items.filter(one => one.id !== id),
      deleted: [gone, ...value.deleted.filter(one => one.id !== id)].slice(0, DELETED_KEEP),
    }
  })
  await closeStep($)
  if (gone !== undefined) await say($, `Deleted "${gone.name}". Restore brings it back.`)
  await refreshSuggest($)
}

async function restoreProfile($: Engine, id: string) {
  let restored: Profile | undefined
  await changeProfiles($, value => {
    const found = value.deleted.find(one => one.id === id)
    if (found === undefined) return value
    const taken = new Set(value.items.map(one => one.id))
    const names = new Set(value.items.map(one => one.name.toLowerCase()))
    restored = {
      ...found,
      id: taken.has(found.id) ? profileId(found.name, taken) : found.id,
      name: names.has(found.name.toLowerCase()) ? cleanName(`${found.name} (restored)`) : found.name,
    }

    return { items: [...value.items, restored], deleted: value.deleted.filter(one => one.id !== id) }
  })
  if (restored !== undefined) await say($, `"${restored.name}" is back.`)
  await refreshSuggest($)
}

/** A card's button: opens its step, or carries it out when it is the "Sure?" press. */
async function profileStep($: Engine, id: string, kind: NonNullable<ProfileAct>['kind']) {
  const current = await read($, view)
  const isSure = current.act !== null && current.act.id === id && current.act.kind === kind
  if (kind === 'delete' && isSure) {
    await deleteProfile($, id)

    return
  }
  if (kind === 'update' && isSure) {
    await updateProfile($, id)

    return
  }
  await update($, view, (now): View => ({ ...now, act: { id, kind } }))
  await update($, notice, () => null)
}

/** What applying a profile would change, in one line, for the place the model shows. */
function previewOf(profile: Profile, m: Model): { text: string; isSame: boolean } {
  if (m.isSession) {
    const plan = planSession(profile, m.inv.skills, m.projectOff, m.offInSession)

    return { text: sessionPlanText(plan), isSame: plan.turnOff.length + plan.turnOn.length === 0 }
  }
  const plan = planProject(profile, m.inv.skills, m.pv)

  return { text: projectPlanText(plan, m.inv.project), isSame: plan.targets.length === 0 }
}

/** Makes a folder match a profile, as one change. */
async function applyToFolder($: Engine, shown: Shown, profile: Pick<Profile, 'off' | 'levels'>, label: string, name: string) {
  const plan = planProject(profile, shown.inv.skills, shown.pv)
  const byId = new Map(shown.inv.skills.map(row => [row.id, row]))
  const targets = plan.targets.flatMap(({ id, level }) => {
    const row = byId.get(id)

    return row === undefined ? [] : [{ row, level }]
  })
  if (targets.length === 0) {
    await say($, `${shown.inv.project} already matches ${name}.`, 'warn')

    return false
  }

  return applyLevels($, shown, targets, label, `${name} applied to ${shown.inv.project}: ${count(targets.length, 'skill')} changed.`)
}

/** The Apply press after the preview: to the folder or the chat the Skills page shows. */
async function applyProfile($: Engine, id: string) {
  const profile = (await loadProfiles($)).items.find(one => one.id === id)
  const current = await read($, view)
  const offer = await read($, suggest)
  // The suggestion banner is about this session's folder, whatever scope is picked.
  const isSuggested = current.page === 'skills' && offer.isPreview && offer.offer?.profileId === id
  const m = isSuggested ? await modelOf($, await hereOf($), 'project') : await currentModel($)
  await closeStep($)
  if (profile === undefined || m === null) return
  if (m.isSession) {
    const plan = planSession(profile, m.inv.skills, m.projectOff, m.offInSession)
    if (plan.turnOff.length + plan.turnOn.length === 0) {
      await say($, `This chat already matches "${profile.name}".`, 'warn')

      return
    }
    await changeSession(
      $,
      { off: plan.turnOff, back: plan.turnOn },
      `profile "${profile.name}" applied (this session)`,
      `"${profile.name}" applied to this chat: ${count(plan.turnOff.length + plan.turnOn.length, 'skill')} changed.`,
    )

    return
  }
  await applyToFolder($, m, profile, `profile "${profile.name}" applied (this project)`, `"${profile.name}"`)
}

// ---------------------------------------------------------------- folder rules: suggest a profile in a folder

async function changeRules($: Engine, id: string, change: (rules: Profile['folders']) => Profile['folders']) {
  await changeProfiles($, value => ({
    ...value,
    items: value.items.map(one => (one.id === id ? { ...one, folders: change(one.folders) } : one)),
  }))
  await refreshSuggest($)
}

async function addRule($: Engine, id: string, folder: string) {
  const card = (await read($, folders)).cards.find(one => one.key === folder)
  if (card === undefined) return
  await changeRules($, id, rules => [
    ...rules.filter(rule => folderKey(rule.path) !== folder),
    { path: card.path, withSubfolders: true },
  ])
  await say($, `It will be suggested in ${card.name} and its subfolders. Nothing is applied by itself.`)
}

async function removeRule($: Engine, id: string, folder: string) {
  await changeRules($, id, rules => rules.filter(rule => folderKey(rule.path) !== folder))
}

async function toggleRule($: Engine, id: string, folder: string) {
  await changeRules($, id, rules =>
    rules.map(rule => (folderKey(rule.path) === folder ? { ...rule, withSubfolders: !rule.withSubfolders } : rule)),
  )
}

/**
 * Works out the suggestion for this session's folder: the profile of the
 * deepest folder rule that covers it, unless the user said "Never here" or
 * "Not now", and only while the folder's setup differs from that profile.
 */
async function refreshSuggest($: Engine): Promise<void> {
  const here = await hereOf($)
  if (here === null) return
  const key = folderKey(here.inv.root)
  const matches = here.pv.fileError === null ? matchRules((await read($, profiles)).items, key) : []
  const dismissed = matches.length > 0 ? await loadDismissed($) : {}
  const now = await read($, suggest)
  const sessionId = await sessionIdOf($)
  const profile = matches.find(
    one => dismissed[rulePair(key, one.id)] !== true && !now.later.includes(inSession(sessionId, rulePair(key, one.id))),
  )
  const offer =
    profile !== undefined && planProject(profile, here.inv.skills, here.pv).targets.length > 0
      ? { profileId: profile.id, name: profile.name }
      : null
  if (JSON.stringify(offer) === JSON.stringify(now.offer)) return
  await update($, suggest, current => ({ ...current, offer, isPreview: false }))
}

/** "Not now" and the toast count for one session only: they are kept under its id. */
function inSession(sessionId: string, pair: string): string {
  return `${sessionId}|${pair}`
}

/** The toast at session start, once per session for each suggestion. */
async function announceSuggestion($: Engine): Promise<void> {
  const here = await read($, inventory)
  const now = await read($, suggest)
  if (here === null || now.offer === null) return
  const pair = inSession(await sessionIdOf($), rulePair(folderKey(here.root), now.offer.profileId))
  if (now.toasted.includes(pair)) return
  await update($, suggest, current => ({ ...current, toasted: [...current.toasted, pair] }))
  $.ui.toast(`This folder usually uses "${now.offer.name}". Open /skills-panel to apply.`)
}

async function suggestApply($: Engine) {
  await update($, suggest, current => ({ ...current, isPreview: true }))
}

async function suggestLater($: Engine) {
  const here = await read($, inventory)
  const now = await read($, suggest)
  if (here === null || now.offer === null) return
  const pair = inSession(await sessionIdOf($), rulePair(folderKey(here.root), now.offer.profileId))
  await update($, suggest, current => ({ ...current, later: [...current.later, pair] }))
  await refreshSuggest($)
}

async function suggestNever($: Engine) {
  const here = await read($, inventory)
  const now = await read($, suggest)
  if (here === null || now.offer === null) return
  const dismissed = await loadDismissed($)
  await saveDismissed($, { ...dismissed, [rulePair(folderKey(here.root), now.offer.profileId)]: true })
  await say($, `"${now.offer.name}" will not be suggested in this folder again.`)
  await refreshSuggest($)
}

// ---------------------------------------------------------------- focus: this chat, one topic

/**
 * Focus this chat on one topic or one profile: everything else goes off for
 * this session only, as one change. 'none' ends the focus: only what it
 * switched off comes back; switches flipped by hand stay as they are.
 */
async function setFocus($: Engine, value: string) {
  const here = await hereOf($)
  if (here === null) return
  const before = await read($, focus)
  const offNow = await read($, sessionOff)
  if (value === 'none') {
    if (before === null) return
    const back = before.added.filter(id => offNow.includes(id))
    await changeSession(
      $,
      { off: [], back },
      `focus on "${before.label}" ended (this session)`,
      `Focus ended: ${count(back.length, 'skill')} back on.`,
      null,
    )

    return
  }

  let label: string
  let wanted: string[]
  let target: { topic: string } | { profileId: string }
  if (value.startsWith('profile:')) {
    const profile = (await loadProfiles($)).items.find(one => one.id === value.slice('profile:'.length))
    if (profile === undefined) return
    const known = new Set(here.inv.skills.map(row => row.id))
    label = profile.name
    wanted = profile.off.filter(id => known.has(id))
    target = { profileId: profile.id }
  } else {
    const topic = value.startsWith('topic:') ? value.slice('topic:'.length) : value
    const picked = await read($, topics)
    label = topic
    // Claude Code's built-in skills and the setup topic stay on, whatever the focus.
    wanted = here.inv.skills
      .filter(row => row.kind !== 'builtin' && row.kind !== 'other')
      .filter(row => topicOf(row, picked) !== topic && topicOf(row, picked) !== SETUP_TOPIC)
      .map(row => row.id)
    target = { topic }
  }

  // Start from the switches as they would be with no focus at all.
  const base = before === null ? offNow : offNow.filter(id => !before.added.includes(id))
  const projectOff = new Set(here.pv.off)
  const added = wanted.filter(id => !projectOff.has(id) && !base.includes(id))
  const after = new Set([...base, ...added])
  const live = here.inv.skills.filter(row => !projectOff.has(row.id) && !after.has(row.id)).length
  await changeSession(
    $,
    { off: [...after].filter(id => !offNow.includes(id)), back: offNow.filter(id => !after.has(id)) },
    `focus on "${label}" (this session)`,
    `Focused on ${label}: ${count(live, 'skill')} on in this chat. Nothing is saved to the project.`,
    { ...target, label, added, at: await $.clock.now() },
  )
}

function focusChoices(
  here: Inventory,
  picked: Readonly<Record<string, string>>,
  saved: Profiles,
  focused: Focus,
): { options: { value: string; label: string }[]; value: string } {
  const options = [
    { value: 'none', label: 'Nothing (all skills)' },
    ...topicsWithSkills(here.skills, picked).map(topic => ({ value: `topic:${topic}`, label: topic })),
    ...saved.items.map(profile => ({ value: `profile:${profile.id}`, label: `Profile: ${profile.name}` })),
  ]
  const value =
    focused === null
      ? 'none'
      : focused.topic !== undefined
        ? `topic:${focused.topic}`
        : focused.profileId !== undefined
          ? `profile:${focused.profileId}`
          : 'none'
  if (focused !== null && !options.some(option => option.value === value)) options.push({ value, label: focused.label })

  return { options, value }
}

// ---------------------------------------------------------------- usage: which skills really run here

/** Shows the counts for the folder the Skills page shows. */
async function showUsage($: Engine, store?: UsageStore): Promise<void> {
  const shown = await shownOf($)
  const root = shown?.inv.root ?? (await $.session.root().catch(() => ''))
  const value = store ?? (await loadUsage($))
  const now = await $.clock.now()
  await update($, usage, () =>
    usageView(value, folderKey(root), now, { isTracking: OPTIONS.trackUsage, unusedDays: OPTIONS.unusedDays }),
  )
}

/** Uses are counted one after another, so two at once cannot lose one. */
let counting: Promise<void> = Promise.resolve()

/** One more use of a skill in this session's folder: one write to the panel's store, nothing else. */
function countUse($: Engine, id: string, who: 'claude' | 'you'): Promise<void> {
  counting = counting
    .then(async () => {
      const root = await $.session.root()
      const store = counted(await loadUsage($), folderKey(root), id, who, await $.clock.now())
      await saveUsage($, store)
      await showUsage($, store)
    })
    .catch(() => undefined)

  return counting
}

/** Notes when counting began in this folder, the first time a session starts there. */
async function beginCounting($: Engine): Promise<void> {
  if (!OPTIONS.trackUsage) return
  const root = await $.session.root()
  const store = began(await loadUsage($), folderKey(root), await $.clock.now())
  if (store !== null) await saveUsage($, store)
}

async function clearUsage($: Engine) {
  const current = await read($, view)
  if (!current.confirmClear) {
    await update($, view, (now): View => ({ ...now, confirmClear: true }))

    return
  }
  await clearUsageData($)
  await beginCounting($)
  await update($, view, (now): View => ({ ...now, confirmClear: false }))
  await showUsage($)
  await say($, 'Usage data cleared. Counting starts again from now.')
}

// ---------------------------------------------------------------- projects: every folder, from one place

/** Remembers that a session started in this folder (never a temp or scratch folder, never the home folder). */
async function noteFolder($: Engine): Promise<void> {
  const { home, root } = await locate($)
  if (!isLocalPath(root) || isNoise(folderKey(root), folderKey(home))) return
  await saveFolders($, withSeen(await loadFolders($), root, await $.clock.now()))
}

/** Reads the folder list: the panel's own record plus Claude Code's, cleaned, with each folder's numbers. */
async function refreshFolders($: Engine): Promise<void> {
  const { home, root } = await locate($)
  const store = await loadFolders($)
  const changedAt = lastChanges(await loadJournal($))
  const hidden = new Set(store.hidden)
  const hereKey = folderKey(root)
  const list = candidates(store.seen, await claudeProjects($), changedAt, folderKey(home)).slice(0, FOLDERS_MAX)
  const present = await existing(
    $,
    list.map(one => one.path),
  )
  const made = await Promise.all(
    list.map(async (one, i): Promise<FolderCard | null> => {
      if (present[i] !== true) return null
      const stat = await folderStats($, one.path)

      return {
        key: one.key,
        path: one.path,
        name: baseName(one.path),
        parent: tilde(parentPath(one.path), home),
        off: stat.off,
        nameOnly: stat.nameOnly,
        lastChange: changedAt.get(one.key) ?? null,
        isHidden: hidden.has(one.key),
        isHere: one.key === hereKey,
        error: stat.error,
      }
    }),
  )
  const cards = made.filter((card): card is FolderCard => card !== null)
  const now = await $.clock.now()
  // This session's folder leads the list.
  await update($, folders, () => ({
    cards: [...cards.filter(card => card.isHere), ...cards.filter(card => !card.isHere)],
    now,
    isLoaded: true,
  }))
}

/** A folder's skills and settings, read fresh: this session's, or another one's. */
async function folderState($: Engine, key: string): Promise<Shown | null> {
  const card = (await read($, folders)).cards.find(one => one.key === key)
  const here = await read($, inventory)
  if (card === undefined || here === null) return null
  if (card.isHere) return loadView($, here, await read($, sessionOff))

  return loadView($, await inventoryFor($, here, card.path), [])
}

/** The Skills page now shows and changes that folder. */
async function manage($: Engine, key: string) {
  const card = (await read($, folders)).cards.find(one => one.key === key)
  if (card === undefined) return
  if ((await read($, inventory)) === null) await refreshAll($)
  const there = card.isHere ? null : await folderState($, key)
  await update($, other, () => there)
  await update(
    $,
    view,
    (current): View => ({ ...current, page: 'skills', scope: 'project', filter: '', show: 'all', detail: null, act: null, copy: null }),
  )
  await update($, notice, () => null)
  await showUsage($)
  await refreshHistory($)
}

async function backHere($: Engine) {
  await update($, other, () => null)
  await update($, view, (current): View => ({ ...current, filter: '', show: 'all', detail: null }))
  await update($, notice, () => null)
  await showUsage($)
  await refreshHistory($)
}

async function toggleHide($: Engine, key: string) {
  const store = await loadFolders($)
  const wasHidden = store.hidden.includes(key)
  await saveFolders($, {
    ...store,
    hidden: wasHidden ? store.hidden.filter(one => one !== key) : [...store.hidden, key],
  })
  const name = (await read($, folders)).cards.find(card => card.key === key)?.name ?? key
  await update($, folders, current => ({
    ...current,
    cards: current.cards.map(card => (card.key === key ? { ...card, isHidden: !wasHidden } : card)),
  }))
  await say($, wasHidden ? `${name} is back in the list.` : `${name} is hidden. "Show hidden" brings it back.`)
}

/** What copying one folder's setup to another would change. */
async function copyPlan($: Engine, from: string, to: string) {
  const source = await folderState($, from)
  const target = await folderState($, to)
  if (source === null || target === null) return null
  const problem = source.pv.fileError ?? target.pv.fileError
  if (problem !== null) {
    await say($, `Nothing copied: ${problem}.`, 'error')

    return null
  }
  const setup = snapshotProject(source.pv, source.inv.skills)

  return { source, target, setup, plan: planProject(setup, target.inv.skills, target.pv) }
}

async function copyAsk($: Engine, from: string, to: string) {
  const found = await copyPlan($, from, to)
  if (found === null) return
  await update($, notice, () => null)
  await update(
    $,
    view,
    (current): View => ({ ...current, copy: { from, to, count: found.plan.targets.length, skipped: found.plan.skipped } }),
  )
}

async function copyGo($: Engine) {
  const asked = (await read($, view)).copy
  if (asked === null) return
  const found = await copyPlan($, asked.from, asked.to)
  await update($, view, (current): View => ({ ...current, copy: null }))
  if (found === null) return
  await applyToFolder(
    $,
    found.target,
    found.setup,
    `setup copied from "${found.source.inv.project}" (this project)`,
    `${found.source.inv.project}'s setup`,
  )
  await refreshFolders($)
}

async function refreshEverything($: Engine) {
  await refreshAll($)
  if ((await read($, folders)).isLoaded) await refreshFolders($)
}

// ---------------------------------------------------------------- session start

async function restoreSession($: Engine): Promise<void> {
  const sessionId = await sessionIdOf($)
  const ids = await loadSessionOff($, sessionId)
  if (ids.length > 0) await update($, sessionOff, current => [...new Set([...current, ...ids])])
  const focused = await loadFocus($, sessionId)
  if (focused !== null) await update($, focus, current => current ?? focused)
  await pruneSessions($, sessionId)
}

/** The grouping the user last picked, the topics they picked for skills, and their profiles. */
async function restoreSaved($: Engine): Promise<void> {
  const groupBy = await loadGroupBy($)
  if (groupBy !== null) await update($, view, (current): View => ({ ...current, groupBy }))
  const picked = await loadTopics($)
  if (picked !== null) await update($, topics, () => picked)
  const saved = await loadProfiles($)
  await update($, profiles, () => saved)
}

async function startup($: Engine): Promise<void> {
  await beginCounting($).catch(() => undefined)
  await refreshAll($)
  await announceSuggestion($).catch(() => undefined)
  // Show the panel by itself once, so it can be found; it counts only once a surface drew it
  // (a session nobody has on screen, or a `claude -p` run, does not use it up).
  if (await isFirstTime($)) {
    const opened = await openPane($)
    if (opened.isPlaced) await markWelcomed($)
  }
}

// ---------------------------------------------------------------- presses

/** Runs one press's work; whatever goes wrong is said in the panel instead of lost. */
function run($: Engine, work: Promise<unknown>): void {
  void work.catch(error => say($, `That did not work: ${String(error)}`, 'error').catch(() => undefined))
}

function actionsFor($: Engine): Act {
  return {
    page: page => run($, setPage($, page)),
    refresh: () => run($, refreshEverything($)),
    undo: () => run($, undoLast($)),

    scope: scope => run($, setScope($, scope)),
    show: show => run($, setShow($, show)),
    filter: text => run($, setFilter($, text)),
    groupBy: groupBy => run($, setGroupBy($, groupBy)),
    toggleGroup: key => run($, toggleOpen($, key)),
    toggleDetail: id => run($, toggleDetail($, id)),
    clearFilters: () => run($, clearFilters($)),
    switchOne: id => run($, switchOne($, id)),
    switchGroup: key => run($, switchGroup($, key)),
    switchPlugin: id => run($, switchPlugin($, id)),
    setLevel: (id, level) => run($, setLevel($, id, level)),
    setTopic: (row, topic) => run($, setTopic($, row, topic)),
    reset: () => run($, resetChanged($)),
    backHere: () => run($, backHere($)),
    setFocus: value => run($, setFocus($, value)),
    suggestApply: () => run($, suggestApply($)),
    suggestLater: () => run($, suggestLater($)),
    suggestNever: () => run($, suggestNever($)),

    saveProfile: name => run($, saveProfile($, name)),
    profileStep: (id, kind) => run($, profileStep($, id, kind)),
    profileCancel: () => run($, closeStep($)),
    applyProfile: id => run($, applyProfile($, id)),
    renameProfile: (id, name) => run($, renameProfile($, id, name)),
    restoreProfile: id => run($, restoreProfile($, id)),
    addRule: (id, folder) => run($, addRule($, id, folder)),
    removeRule: (id, folder) => run($, removeRule($, id, folder)),
    toggleRule: (id, folder) => run($, toggleRule($, id, folder)),

    manage: folder => run($, manage($, folder)),
    toggleHide: folder => run($, toggleHide($, folder)),
    toggleShowHidden: () => run($, update($, view, (current): View => ({ ...current, showHidden: !current.showHidden }))),
    toggleAllFolders: () => run($, update($, view, (current): View => ({ ...current, allFolders: !current.allFolders }))),
    copyAsk: (from, to) => run($, copyAsk($, from, to)),
    copyGo: () => run($, copyGo($)),
    copyCancel: () => run($, update($, view, (current): View => ({ ...current, copy: null }))),
    clearUsage: () => run($, clearUsage($)),

    historyScope: scope => run($, setHistoryScope($, scope)),
    undoAt: at => run($, undoEntry($, at)),
  }
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  OPTIONS.trackUsage = options['trackUsage'] !== false
  const days = options['unusedDays']
  OPTIONS.unusedDays = typeof days === 'number' && Number.isFinite(days) && days >= 1 ? Math.round(days) : 30

  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'skills-panel',
        description: 'Open the Skills panel: switch skills on or off for this project or this session',
        argumentHint: '[project|session]',
      })
      .catch(() => undefined)
    await $.tool
      .register({
        name: 'open_panel',
        description:
          'Opens the Skills panel beside the chat, where the user switches skills on or off for this project or for this session. Use it when the user asks to see, manage, or switch skills on or off. Returns what is on and off. It changes nothing by itself: the user flips the switches.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      })
      .catch(() => undefined)
    await restoreSession($).catch(() => undefined)
    await restoreSaved($).catch(() => undefined)
    await noteFolder($).catch(() => undefined)
    $.clock.after(800, () => {
      void startup($).catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'skills-panel' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'session' || arg === 'project') await setScope($, arg)
    await refreshAll($)
    const opened = await openPane($)

    return {
      text: opened.isPlaced
        ? 'Skills panel opened.'
        : `Skills panel is ready but not shown (${opened.reason ?? 'no room'}).`,
    }
  })

  on('tool.call', { tool: 'mcp__skills-panel__open_panel' }, async $ => {
    await refreshAll($)

    return { result: await summary($, await openPane($)) }
  })

  // This session's switches: the skill leaves the list Claude reads.
  on('prompt.attachment', { type: 'skill_listing' }, async ($, e, next) => {
    const done = await next(e)
    if (done.text === null) return done
    const offInSession = new Set(await read($, sessionOff))
    const permissions = await $.settings.read({ key: 'permissions' }).catch(() => undefined)
    const rules = allDenyRules([{ source: 'local', settings: isRecord(permissions) ? { permissions } : {} }]).filter(
      rule => /^\s*Skill\b/.test(rule),
    )
    if (offInSession.size === 0 && rules.length === 0) return done

    return {
      text: filterListing(done.text, name => offInSession.has(name) || rules.some(rule => denies(rule, name))),
    }
  }).catch(($, e, next) => next(e))

  // This session's switches: Claude's Skill call is refused. A call that ran is counted as one use.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const id = String(e.skill ?? '').trim().replace(/^\//, '')
    const offInSession = await read($, sessionOff)
    if (id !== '' && offInSession.includes(id)) {
      return {
        deny: `The "${id}" skill is switched off for this session in the Skills panel. Do not use it or copy its steps; carry on without it, or ask the user to switch it back on.`,
      }
    }
    const done = await next(e)
    if (OPTIONS.trackUsage && id !== '' && done.deny === undefined && done.isError !== true) await countUse($, id, 'claude')

    return done
  }).catch(($, e, next) => next(e))

  // This session's switches: `/name` is refused; one that ran is counted as one use.
  // And Claude hears of every change with the next prompt.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) {
      const name = e.command.name
      const offInSession = await read($, sessionOff)
      if (offInSession.includes(name)) {
        return { drop: `"${name}" is off for this session. Switch it back on in the Skills panel (/skills-panel).` }
      }
      const done = await next(e)
      const here = await read($, inventory)
      const isSkill = here !== null && here.skills.some(row => row.id === name && row.kind !== 'other')
      if (OPTIONS.trackUsage && isSkill && done.drop === undefined) await countUse($, name, 'you')

      return done
    }
    if (e.isMeta === true) return next(e)
    const note = noteFor(await read($, pending))
    if (note === null) return next(e)
    await update($, pending, () => ({}))

    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const kit: Kit = {
      Box: table.Box,
      Text: table.Text,
      Button: table.Button,
      Input: table.Input,
      Select: table.Select,
      isTerminal: e.surface === 'terminal',
      cells: Math.max(8, Math.min(48, e.props.bodyColumns - 6)),
      // Pictures: SVG where the surface draws it, the fallback on the terminal.
      picture: (source, alt, fallback) => {
        if (e.surface === 'terminal') return fallback
        const { Svg } = $.ui.resolve(e)

        return <Svg source={source} alt={alt} />
      },
    }
    const m = await currentModel($)
    const isBusy = await read($, busy)

    if (m === null) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{isBusy ? 'Reading your skills…' : 'The skill list is not loaded yet.'}</Text>
          {!isBusy && <Button key="load" variant="primary" label="Load skills" onPress={() => run($, refreshAll($))} />}
        </Box>
      )
    }

    const act = actionsFor($)
    const said = await read($, notice)
    const lastChange = await read($, undoLabel)
    const saved = await read($, profiles)
    const used = await read($, usage)
    const { current } = m
    let body

    if (current.page === 'profiles') {
      const open = current.act
      const profile = open !== null && open.kind === 'apply' ? saved.items.find(one => one.id === open.id) : undefined
      const cards = (await read($, folders)).cards.filter(card => !card.isHidden)
      const names = cards.map(card => card.name)
      body = profilesPage(
        kit,
        {
          profiles: saved,
          act: open,
          preview: profile === undefined ? null : previewOf(profile, m),
          where: m.isSession ? 'this chat' : m.inv.project,
          isSession: m.isSession,
          isOther: m.isOther,
          now: profileSummary(setupOf(m)),
          said,
          lastChange,
          folders: cards.map(card => ({
            key: card.key,
            // Two folders of one name are told apart by where they sit.
            label: `${card.name}${names.filter(name => name === card.name).length > 1 ? ` (${card.parent})` : ''}${card.isHere ? ' · this folder' : ''}`,
          })),
        },
        act,
      )
    } else if (current.page === 'projects') {
      const listed = await read($, folders)
      const here = await read($, inventory)
      body = projectsPage(
        kit,
        {
          cards: listed.cards,
          now: listed.now,
          isLoaded: listed.isLoaded,
          skills: (here ?? m.inv).skills.filter(row => row.kind !== 'other').length,
          copy: current.copy,
          showHidden: current.showHidden,
          allFolders: current.allFolders,
          said,
          isTracking: OPTIONS.trackUsage,
          confirmClear: current.confirmClear,
        },
        act,
      )
    } else if (current.page === 'history') {
      body = historyPage(kit, { history: await read($, history), said, folder: m.inv.project }, act)
    } else {
      const focused = await read($, focus)
      const here = await hereOf($)
      const offered = await read($, suggest)
      const suggested = offered.offer === null ? undefined : saved.items.find(one => one.id === offered.offer?.profileId)
      const choices = focusChoices(here?.inv ?? m.inv, m.picked, saved, focused)
      const unused = m.inv.skills.filter(m.isUnused).length
      const isDue = used.isTracking && used.since !== null && used.now - used.since >= used.unusedDays * DAY_MS
      body = skillsPage(
        kit,
        {
          m,
          isBusy,
          said,
          lastChange,
          focus: focused,
          focusOptions: choices.options,
          focusValue: choices.value,
          offer:
            suggested === undefined || here === null
              ? null
              : {
                  profileId: suggested.id,
                  name: suggested.name,
                  preview: offered.isPreview
                    ? projectPlanText(planProject(suggested, here.inv.skills, here.pv), here.inv.project)
                    : null,
                },
          used,
          unusedHint: isDue && unused >= UNUSED_HINT_FROM ? unused : null,
        },
        act,
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {tabs(kit, current.page, act)}
        {body}
      </Box>
    )
  })
}
