// Projects: every folder's skills, from one place.
import { expect, test } from 'claude-code/testing'

import { candidates, isLocalPath, isNoise, readFolders, tilde, withSeen } from '../hooks/folders'
import { folderKey, parentPath } from '../hooks/lib'
import { HOME, LOCAL, OTHER, OTHER_LOCAL, ROOT, SLOW, local, openPanel, shows, world } from './world'

const EXCLUDE = `${ROOT}/.git/info/exclude`

test('folder keys: lowercased, forward slashes, no trailing slash', () => {
  expect(folderKey('C:\\Work\\Proj\\')).toBe('c:/work/proj')
  expect(folderKey('C:/work/proj')).toBe('c:/work/proj')
  expect(folderKey('/home/me/Proj/')).toBe('/home/me/proj')
  expect(parentPath('C:\\Work\\Proj')).toBe('C:\\Work')
  expect(tilde('C:\\Home\\docs', 'C:/home')).toBe('~\\docs')
  expect(tilde('D:/elsewhere', 'C:/home')).toBe('D:/elsewhere')
})

test('the folder list is cleaned: one entry per folder, no remotes, worktrees, temp folders or home', () => {
  expect(isLocalPath('C:\\work\\a')).toBe(true)
  expect(isLocalPath('/home/me/a')).toBe(true)
  expect(isLocalPath('ssh://box/home/me/a')).toBe(false)
  expect(isLocalPath('ssh:box:/home/me/a')).toBe(false)
  expect(isLocalPath('\\\\server\\share\\a')).toBe(false)
  expect(isLocalPath('//server/share/a')).toBe(false)

  const home = folderKey(HOME)
  expect(isNoise(home, home)).toBe(true)
  expect(isNoise('c:/work/a/.claude/worktrees/fix-1', home)).toBe(true)
  expect(isNoise('c:/users/me/appdata/local/temp/x', home)).toBe(true)
  expect(isNoise('c:/users/me/appdata/roaming/claude/scratch-workspaces/a/b', home)).toBe(true)
  expect(isNoise('/tmp/build', home)).toBe(true)
  expect(isNoise('/private/var/folders/ab/x', home)).toBe(true)
  expect(isNoise('c:/work/a', home)).toBe(false)
  // A project folder that merely has "tmp" in its path stays.
  expect(isNoise('/home/me/tmp/project', home)).toBe(false)

  const list = candidates(
    { 'c:/work/seen': { path: 'C:\\Work\\Seen', at: 5_000 } },
    ['C:/work/a', 'c:\\WORK\\A\\', 'C:/work/b', 'ssh://box/x', 'C:/work/a/.claude/worktrees/w1', HOME, 'C:/work/seen'],
    new Map([['c:/work/a', 9_000]]),
    home,
  )
  // Most recently used first: a (changed at 9000), seen (5000), then b (no time known).
  expect(list).toEqual([
    { key: 'c:/work/a', path: 'C:/work/a', at: 9_000 },
    { key: 'c:/work/seen', path: 'C:\\Work\\Seen', at: 5_000 },
    { key: 'c:/work/b', path: 'C:/work/b', at: 0 },
  ])

  // The panel's own record: read back safely, and held to a size.
  expect(readFolders({ version: 1, seen: { a: { path: 'C:/a', at: 1 }, b: 'junk' }, hidden: ['x', 3] })).toEqual({
    version: 1,
    seen: { a: { path: 'C:/a', at: 1 } },
    hidden: ['x'],
  })
  expect(withSeen(readFolders(undefined), 'C:\\Work\\A', 7).seen).toEqual({ 'c:/work/a': { path: 'C:\\Work\\A', at: 7 } })
})

test('the Projects page lists real project folders once each, this folder first', SLOW, async ($, on) => {
  const w = world(on, {
    projects: [
      OTHER,
      'c:\\WORK\\OTHER\\',
      ROOT,
      'C:/Proj',
      `${ROOT}/.claude/worktrees/fix-1`,
      'ssh://box/home/me/site',
      'C:/gone',
      HOME,
      'C:/Users/me/AppData/Local/Temp/job-1',
      'C:/x/scratch-workspaces/y',
    ],
  })
  // Every folder but C:/gone is really there: the list must drop the others for what they are.
  for (const path of [`${ROOT}/.claude/worktrees/fix-1`, 'C:/Users/me/AppData/Local/Temp/job-1', 'C:/x/scratch-workspaces/y']) {
    w.folders.add(path)
  }
  w.files[OTHER_LOCAL] = JSON.stringify({ skillOverrides: { alpha: 'off', beta: 'name-only' }, permissions: { deny: ['Skill(cloudflare:wrangler)', 'Read(./.env)'] } })
  const ui = await openPanel($)
  await ui.press({ key: 'page:projects' })

  const cards = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('manage:'))
  expect(cards).toEqual(['manage:c:/proj', 'manage:c:/work/other'])
  expect(await ui.find({ type: 'Text', text: /^2 off · 1 name only$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^0 off · 0 name only$/ })).toBeDefined()
  // Nothing else from Claude Code's own file reaches the page.
  expect(await ui.find({ type: 'Text', text: /not for the panel/ })).toBeUndefined()
  await ui.unmount()
})

test('a missing or broken list of folders falls back to the ones the panel has seen', SLOW, async ($, on) => {
  const w = world(on, { store: { folders: { version: 1, seen: { 'c:/work/other': { path: OTHER, at: 400 } }, hidden: [] } } })
  w.files[`${HOME}/.claude.json`] = '{ not json'
  const ui = await openPanel($)
  await ui.press({ key: 'page:projects' })
  const cards = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('manage:'))
  // This session's folder was noted when the session started; the other one in an earlier session.
  expect(cards).toEqual(['manage:c:/proj', 'manage:c:/work/other'])
  await ui.unmount()
})

test('Manage shows another folder: its own skills, its own file, and nothing of this chat', SLOW, async ($, on) => {
  const w = world(on)
  const ui = await openPanel($)
  await ui.press({ key: 'page:projects' })
  // Looking is not writing.
  await ui.press({ key: 'manage:c:/work/other' })
  expect(w.files[OTHER_LOCAL]).toBeUndefined()

  expect(await ui.find({ type: 'Text', text: /^Skills · other \(another folder\)$/ })).toBeDefined()
  expect((await ui.find({ key: 'page:skills' }))?.props['variant']).toBe('primary')
  // Session switches and Focus belong to this chat's own folder.
  expect(await ui.find({ key: 'scope:session' })).toBeUndefined()
  expect(await ui.find({ key: 'focus' })).toBeUndefined()

  // That folder's own skill is listed; this session's folder's own is not.
  await ui.press({ key: 'open:topic:Other' })
  expect(await ui.find({ key: 'sw:delta' })).toBeDefined()
  expect(await ui.find({ key: 'sw:gamma' })).toBeUndefined()

  await ui.press({ key: 'sw:alpha' })
  await ui.press({ key: 'info:delta' })
  await ui.select({ key: 'level:delta', value: 'name-only' })
  expect(local(w, OTHER_LOCAL)).toEqual({ skillOverrides: { alpha: 'off', delta: 'name-only' } })
  expect(w.files[LOCAL]).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /for other: Name only/ })).toBeDefined()

  // This chat is untouched: alpha still runs here, and Claude is told nothing.
  expect((await $.tool.call({ tool: 'Skill', skill: 'alpha' })).deny).toBeUndefined()
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[0]?.context).toEqual([])

  // Undo and Back to default act on that folder.
  await ui.press({ key: 'undo' })
  expect(local(w, OTHER_LOCAL)).toEqual({ skillOverrides: { alpha: 'off' } })
  await ui.press({ key: 'show:changed' })
  await ui.press({ key: 'reset' })
  expect(local(w, OTHER_LOCAL)).toEqual({})

  // Back to this folder.
  await ui.press({ key: 'target:back' })
  expect(await ui.find({ type: 'Text', text: /^Skills · proj$/ })).toBeDefined()
  expect(await ui.find({ key: 'scope:session' })).toBeDefined()
  expect(await ui.find({ key: 'sw:gamma' })).toBeDefined()
  expect(await ui.find({ key: 'sw:delta' })).toBeUndefined()
  // The Undo line is this folder's again: nothing was changed here.
  expect(await ui.find({ key: 'undo' })).toBeUndefined()
  await ui.unmount()
})

test('Manage on this folder\'s own card just opens the Skills page for it', SLOW, async ($, on) => {
  world(on)
  const ui = await openPanel($)
  await ui.press({ key: 'page:projects' })
  await ui.press({ key: 'manage:c:/proj' })
  expect(await ui.find({ type: 'Text', text: /^Skills · proj$/ })).toBeDefined()
  expect(await ui.find({ key: 'target:back' })).toBeUndefined()
  await ui.unmount()
})

test('Copy setup to another folder: a preview first, one change there, undone there', SLOW, async ($, on) => {
  const w = world(on)
  w.files[LOCAL] = JSON.stringify({ skillOverrides: { alpha: 'off', gamma: 'off', beta: 'name-only' }, permissions: { deny: ['Skill(cloudflare:wrangler)'] } })
  w.files[OTHER_LOCAL] = JSON.stringify({ skillOverrides: { delta: 'off' }, model: 'opus' })
  const mine = w.files[LOCAL]
  const theirs = w.files[OTHER_LOCAL]
  const ui = await openPanel($)
  await ui.press({ key: 'page:projects' })

  await ui.select({ key: 'copy:c:/proj', value: 'c:/work/other' })
  // alpha off, beta name only, the plugin skill off, and delta (off there, not in this setup) back on.
  // gamma exists only here, so it is not counted.
  expect((await ui.find({ type: 'Text', text: /^Changes / }))?.text).toBe('Changes 4 skills in other.')
  expect(w.files[OTHER_LOCAL]).toBe(theirs)
  await ui.press({ key: 'copy-no:c:/proj' })
  expect(await ui.find({ key: 'copy-yes:c:/proj' })).toBeUndefined()
  expect(w.files[OTHER_LOCAL]).toBe(theirs)

  await ui.select({ key: 'copy:c:/proj', value: 'c:/work/other' })
  await ui.press({ key: 'copy-yes:c:/proj' })
  expect(local(w, OTHER_LOCAL)).toEqual({
    skillOverrides: { alpha: 'off', beta: 'name-only' },
    model: 'opus',
    permissions: { deny: ['Skill(cloudflare:wrangler)'] },
  })
  expect(w.files[LOCAL]).toBe(mine)
  expect(await ui.find({ type: 'Text', text: /^proj's setup applied to other: 4 skills changed\.$/ })).toBeDefined()
  // The other folder's card shows its new numbers.
  expect(await ui.find({ type: 'Text', text: /^2 off · 1 name only · last change just now$/ })).toBeDefined()

  // The change is in that folder's history: one Undo there puts its file back.
  await ui.press({ key: 'page:history' })
  expect(await ui.find({ type: 'Text', text: /setup copied from "proj"/ })).toBeUndefined()
  await ui.select({ key: 'history:scope', value: 'all' })
  expect(await ui.find({ type: 'Text', text: /setup copied from "proj" · other/ })).toBeDefined()
  await ui.press({ key: 'undo:1000' })
  expect(local(w, OTHER_LOCAL)).toEqual(JSON.parse(theirs ?? '{}'))
  await ui.unmount()
})

test('Hide takes a folder off the list; Show hidden brings it back', SLOW, async ($, on) => {
  world(on)
  const ui = await openPanel($)
  await ui.press({ key: 'page:projects' })
  expect(await ui.find({ key: 'hidden' })).toBeUndefined()

  await ui.press({ key: 'hide:c:/work/other' })
  expect(await ui.find({ key: 'manage:c:/work/other' })).toBeUndefined()
  expect(await shows(ui, 'hidden')).toBe('Show hidden (1)')
  // A hidden folder is not offered as a place to copy to either.
  expect(await ui.find({ key: 'copy:c:/proj' })).toBeUndefined()

  await ui.press({ key: 'hidden' })
  expect(await ui.find({ key: 'manage:c:/work/other' })).toBeDefined()
  expect(await shows(ui, 'hide:c:/work/other')).toBe('Unhide')
  await ui.press({ key: 'hide:c:/work/other' })
  expect(await shows(ui, 'hide:c:/work/other')).toBe('Hide')
  expect(await ui.find({ key: 'hidden' })).toBeUndefined()
  await ui.unmount()
})

test('git: a settings file the panel creates is added to .git/info/exclude, once, and .gitignore is never touched', SLOW, async ($, on) => {
  const w = world(on)
  w.git.isRepo = true
  const ui = await openPanel($)
  await ui.press({ key: 'open:topic:Other' })

  // The first switch creates the file: its path goes into the repository's own exclude file.
  await ui.press({ key: 'sw:alpha' })
  expect(w.files[EXCLUDE]).toBe('/.claude/settings.local.json\n')
  expect(await ui.find({ type: 'Text', text: /kept out of git \(added to \.git\/info\/exclude\)/ })).toBeDefined()

  // The file is there now: later switches say nothing more and add nothing.
  await ui.press({ key: 'sw:gamma' })
  expect(w.files[EXCLUDE]).toBe('/.claude/settings.local.json\n')
  expect(await ui.find({ type: 'Text', text: /kept out of git/ })).toBeUndefined()

  // Even when the file is created again, the line is not added twice.
  delete w.files[LOCAL]
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'sw:alpha' })
  expect(w.files[EXCLUDE]).toBe('/.claude/settings.local.json\n')
  expect(Object.keys(w.files).some(file => file.endsWith('.gitignore'))).toBe(false)
  expect(w.ran.every(argv => argv[0] === 'git' && (argv[1] === 'check-ignore' || argv[1] === 'rev-parse'))).toBe(true)
  await ui.unmount()
})

test('git: a settings file that was there already is left to its owner: git is not even asked', SLOW, async ($, on) => {
  const w = world(on)
  w.git.isRepo = true
  // The file exists, and the repository may well track it on purpose.
  w.files[LOCAL] = JSON.stringify({ model: 'opus' })
  const ui = await openPanel($)
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:alpha' })
  expect(local(w)).toEqual({ model: 'opus', skillOverrides: { alpha: 'off' } })
  expect(w.files[EXCLUDE]).toBeUndefined()
  expect(w.ran).toEqual([])
  await ui.unmount()
})

test('git: a project in a subfolder gets its own path, after what the exclude file already holds', SLOW, async ($, on) => {
  const w = world(on)
  w.git.isRepo = true
  w.git.prefix = 'apps/site [new]/'
  w.files[EXCLUDE] = '# local only\n*.log'
  const ui = await openPanel($)
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:alpha' })
  expect(w.files[EXCLUDE]).toBe('# local only\n*.log\n/apps/site \\[new\\]/.claude/settings.local.json\n')
  await ui.unmount()
})

test('git: nothing is added when git ignores the file already, when the folder is no repository, or when git is missing', SLOW, async ($, on) => {
  const w = world(on)
  const ui = await openPanel($)
  await ui.press({ key: 'open:topic:Other' })

  // Already ignored (a global gitignore, say).
  w.git.isRepo = true
  w.git.isIgnored = true
  await ui.press({ key: 'sw:alpha' })
  expect(w.files[EXCLUDE]).toBeUndefined()

  // Not a repository.
  delete w.files[LOCAL]
  w.git.isRepo = false
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'sw:alpha' })
  expect(w.files[EXCLUDE]).toBeUndefined()

  // No git on this computer: the switch still works, and nothing is said about git.
  delete w.files[LOCAL]
  w.git.isInstalled = false
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'sw:alpha' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off' } })
  expect(w.files[EXCLUDE]).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^"alpha" is OFF for this project\.$/ })).toBeDefined()
  await ui.unmount()
})
