/** Where a skill comes from, as the panel groups it. */
export type SkillKind = 'global' | 'project' | 'plugin' | 'app' | 'builtin' | 'other'

/** A `skillOverrides` value: how Claude sees a skill. Absent means `on`. */
export type Level = 'on' | 'name-only' | 'user-invocable-only' | 'off'

/** One skill the panel lists. `id` is the name Claude and the settings use. */
export type SkillRow = {
  id: string
  kind: SkillKind
  /** `global`, `project`, `plugin:<name>`, `app:<name>`, `builtin` or `other`. */
  group: string
  description: string
  /** `disable-model-invocation: true` in its SKILL.md: only `/name` runs it. */
  isManual: boolean
  /** A short extra fact, such as "also in this project". */
  note: string | null
  /** Its entry's estimated tokens in Claude's skill list; null when it is not listed now. */
  tokens: number | null
}

/** An installed plugin (from installed_plugins.json). */
export type PluginEntry = {
  /** `name@marketplace`, the key `enabledPlugins` uses. */
  id: string
  name: string
  /** True when its skills are loaded in this session. */
  hasSkills: boolean
}

/** Claude's skill list as the engine measured it: how many skills, how many fit, and its tokens. */
export type Budget = {
  total: number
  included: number
  tokens: number
}

/** Everything that exists in one folder, whatever is on or off. */
export type Inventory = {
  root: string
  /** The folder's name, for the header. */
  project: string
  /** That folder's `.claude/settings.local.json`. */
  file: string
  /** True when the folder is the user's home folder. */
  isHome: boolean
  /** True for a folder managed from the Projects page: not the one this session runs in. */
  isOther: boolean
  skills: SkillRow[]
  plugins: PluginEntry[]
  budget: Budget | null
}

/** A plugin's state for one folder. */
export type PluginStatus = {
  id: string
  isOn: boolean
  /** Why the panel cannot change it here, when it cannot. */
  lockedBy: string | null
}

/** What is on or off for one folder, read from the settings files. */
export type ProjectView = {
  /** Ids off for the folder, whichever settings file says so. */
  off: string[]
  /** Id to the reason the panel cannot change it ("blocked in managed policy"). */
  locked: Record<string, string>
  /** Id to an extra tag ("off in your user settings"). */
  tags: Record<string, string>
  /** Id to its level, for skills whose level in force is not plain `on`. */
  levels: Record<string, Level>
  /** Id to the level "on" means there, where the settings below give name only or only you. */
  onLevels: Record<string, Level>
  /** Ids the folder's own settings.local.json changes (a level or a panel deny rule). */
  changed: string[]
  plugins: PluginStatus[]
  /** Set when settings.local.json cannot be read as JSON: nothing is written then. */
  fileError: string | null
}

/** A folder managed from the Projects page, in place of the session's own. */
export type Other = { inv: Inventory; pv: ProjectView } | null

export type Scope = 'project' | 'session'

/** The panel's four pages. */
export type Page = 'skills' | 'profiles' | 'projects' | 'history'

/** Which rows the list shows. */
export type Show = 'all' | 'on' | 'off' | 'changed' | 'unused'

/** How the list is grouped: by topic, or by where a skill comes from. */
export type GroupBy = 'topic' | 'source'

/** Which changes the History page lists. */
export type HistoryScope = 'folder' | 'chat' | 'all'

/** A profile card's open step: its Apply preview, its rename field, or a "Sure?". */
export type ProfileAct = { id: string; kind: 'apply' | 'rename' | 'delete' | 'update' } | null

/** A "Copy setup to…" waiting for its Copy press, on the Projects page. */
export type CopyAsk = { from: string; to: string; count: number; skipped: number } | null

/** The panel's own view state, for this session. */
export type View = {
  page: Page
  scope: Scope
  filter: string
  show: Show
  groupBy: GroupBy
  /** Expanded group keys (`topic:<name>` or a source group). */
  open: string[]
  /** The skill whose details are open. */
  detail: string | null
  act: ProfileAct
  /** The History filter; null follows the scope picked on the Skills page. */
  history: HistoryScope | null
  copy: CopyAsk
  /** Projects page: hidden folders are listed too. */
  showHidden: boolean
  /** Projects page: every folder is listed, not only the most recent. */
  allFolders: boolean
  /** Projects page: "Clear usage data" was pressed once. */
  confirmClear: boolean
}

export type Notice = {
  text: string
  tone: 'ok' | 'warn' | 'error'
} | null

/** A change Claude has not been told about yet: told with the next prompt. */
export type PendingNote = {
  scope: Scope
  id: string
  isOn: boolean
  description: string
  /** The project level it now has, when one was picked in the details. */
  level?: Level
}

/** One change the panel made, so Undo can put it back exactly. */
export type Op =
  | { kind: 'override'; id: string; before: string | null; after: string | null }
  | { kind: 'deny'; id: string; before: boolean; after: boolean }
  | { kind: 'plugin'; id: string; before: boolean | null; after: boolean | null }
  | { kind: 'session'; id: string; before: boolean; after: boolean }

/** "For this chat, keep only one topic (or one profile)": what is in force, and what it switched off. */
export type Focus = {
  topic?: string
  profileId?: string
  /** What the banner and the status line call it. */
  label: string
  /** The ids this focus switched off for the session, less those changed by hand since. */
  added: string[]
  at: number
} | null

export type JournalEntry = {
  /** When it was made; no two entries share one, so it also names the entry. */
  at: number
  scope: Scope
  root: string
  file: string
  sessionId: string
  label: string
  ops: Op[]
  /** Set when the change also changed the focus, so Undo puts that back too. */
  focus?: { before: Focus; after: Focus }
}

/** A level a profile can hold for a skill that is on. */
export type ProfileLevel = 'name-only' | 'user-invocable-only'

/** "Suggest this profile in this folder." */
export type FolderRule = { path: string; withSubfolders: boolean }

/** A saved setup: which skills are off, and which are at a finer level. */
export type Profile = {
  id: string
  name: string
  off: string[]
  levels: Record<string, ProfileLevel>
  folders: FolderRule[]
  createdAt: number
  updatedAt: number
}

/** Every profile, and the last few deleted ones. */
export type Profiles = { items: Profile[]; deleted: Profile[] }

/** One line of the History page. */
export type HistoryRow = {
  at: number
  /** "3 min ago". */
  ago: string
  /** The change without its scope: `"alpha" off`. */
  what: string
  /** "this project", "this chat", or a folder's name. */
  where: string
  /** undo: can be undone now; later: a newer change touched the same skill; away: another chat's. */
  state: 'undo' | 'later' | 'away'
}

export type HistoryView = { rows: HistoryRow[]; total: number; scope: HistoryScope }

/** How often one skill was used in one folder. */
export type UseCount = { claude: number; you: number; last: number }

/** Usage as the Skills page shows it, for the folder it shows. */
export type UsageView = {
  /** False when the trackUsage option is off. */
  isTracking: boolean
  /** When counting began in this folder; null before the first session there. */
  since: number | null
  here: Record<string, UseCount>
  /** Uses in every folder together, by skill. */
  everywhere: Record<string, number>
  /** When these were read, for "2 days ago". */
  now: number
  unusedDays: number
}

/** One folder on the Projects page. */
export type FolderCard = {
  /** The path lowercased, with forward slashes and no trailing slash. */
  key: string
  path: string
  name: string
  /** The folder it sits in, with the home folder written `~`. */
  parent: string
  /** Skills its own settings.local.json switches off. */
  off: number
  nameOnly: number
  /** The panel's last change there, or null. */
  lastChange: number | null
  isHidden: boolean
  /** The folder this session runs in. */
  isHere: boolean
  /** Why its settings.local.json cannot be read, when it cannot. */
  error: string | null
}

export type FoldersView = { cards: FolderCard[]; now: number; isLoaded: boolean }

/** A folder rule's suggestion for this session's folder. */
export type Suggest = {
  /** The profile suggested here, while this folder's setup differs from it. */
  offer: { profileId: string; name: string } | null
  /** `<folderKey>|<profileId>` pairs put off with "Not now": this session only. */
  later: string[]
  /** Pairs this session already announced with a toast. */
  toasted: string[]
  /** Apply was pressed: the banner shows what would change. */
  isPreview: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'skills-panel': {
      /** The folder this session runs in. */
      inventory: Shaped<Inventory | null>
      project: Shaped<ProjectView | null>
      /** Another folder being managed, when one is. */
      other: Shaped<Other>
      sessionOff: Shaped<string[]>
      view: Shaped<View>
      notice: Shaped<Notice>
      pending: Shaped<Record<string, PendingNote>>
      undoLabel: Shaped<string | null>
      /** Skill id to the topic the user picked for it (all projects). */
      topics: Shaped<Record<string, string>>
      profiles: Shaped<Profiles>
      focus: Shaped<Focus>
      history: Shaped<HistoryView>
      usage: Shaped<UsageView>
      folders: Shaped<FoldersView>
      suggest: Shaped<Suggest>
      busy: boolean
    }
  }
}
