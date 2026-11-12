# Changelog

What changed in each version, newest first.

## 1.0.0 (2026-11-12)

The first public release.

### Added

- **Four pages**, as tabs at the top of the panel: Skills, Profiles, Projects and History.
- **Profiles.** Save the setup you see under a name, then apply it in any folder or chat. Apply always shows what would change first. Update, rename, delete and restore.
- **Focus this chat.** Keep one topic (or one profile) on for one chat. End focus brings back only what the focus turned off.
- **History.** The newest 50 changes for this folder, this chat or everywhere, each with its own Undo.
- **Usage.** How often Claude or you ran each skill in each folder, an Unused filter, and a line that points out skills nobody uses. Counted on your computer only. Two options: `trackUsage` and `unusedDays`.
- **Projects.** Every folder you used Claude in, in one list. Manage another folder's skills from here, or copy one folder's setup to another.
- **Folder rules.** A profile can be suggested when you open a folder. It is never applied by itself.
- A settings file the panel creates inside a git repository is added to that repository's `.git/info/exclude`, so it is not committed by accident.

### Changed

- The history keeps 500 changes instead of 300.
- The code is split into one file per page and per kind of logic.

## 0.2.0 (2026-11-12)

### Added

- Skills grouped by topic, with a switch for a whole topic.
- Slide switches, an overview with a ring chart, and an estimate of what the skill list costs in context.
- Filters (All, On, Off, Changed) and "Back to default".
- Details for each skill: how Claude sees it (On, Name only, Only you, Off) and its topic.

## 0.1.0 (2026-11-11)

- The first version: a side panel that switches skills on or off for one project or for one session, with Undo.
