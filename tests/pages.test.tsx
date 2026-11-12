// The four pages: each one draws on every surface, and state an older version
// kept is declined cleanly.
import { expect, test } from 'claude-code/testing'

import { PANE, ROOT, SLOW, openPanel, world } from './world'

const PAGES = [
  { page: 'profiles', title: /^Profiles$/, has: 'profile:new' },
  { page: 'projects', title: /^Projects$/, has: 'manage:c:/proj' },
  { page: 'history', title: /^History$/, has: 'history:scope' },
  { page: 'skills', title: /^Skills · proj$/, has: 'scope:session' },
] as const

test('every page draws on every surface, and its tab is the marked one', SLOW, async ($, on) => {
  world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'desktop') await ui.press({ key: 'load' })
    for (const { page, title, has } of PAGES) {
      await ui.press({ key: `page:${page}` })
      expect(await ui.find({ type: 'Text', text: title }), `${page} on ${surface}`).toBeDefined()
      expect(await ui.find({ key: has }), `${has} on ${surface}`).toBeDefined()
      expect((await ui.find({ key: `page:${page}` }))?.props['variant']).toBe('primary')
      expect((await ui.find({ key: `page:${page === 'skills' ? 'history' : 'skills'}` }))?.props['variant']).toBe('secondary')
    }
    await ui.unmount()
  }
})

test('every page draws on every surface with everything on it: banners, previews, cards and rows', SLOW, async ($, on) => {
  const w = world(on, {
    many: 9,
    builtins: ['review'],
    store: {
      profiles: {
        version: 1,
        items: [
          {
            id: 'video-work',
            name: 'Video work',
            off: ['alpha', 'ghost'],
            levels: { beta: 'name-only' },
            folders: [{ path: ROOT, withSubfolders: true }],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        deleted: [{ id: 'old', name: 'Old', off: [], levels: {}, folders: [], createdAt: 1, updatedAt: 1 }],
      },
      usage: { version: 1, folders: { 'c:/proj': { since: 1, skills: { alpha: { claude: 2, you: 1, last: 900 } } } } },
    },
  })
  w.files[`${ROOT}/.claude/settings.local.json`] = JSON.stringify({ skillOverrides: { gamma: 'off' } })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  // A change and a focus, so History has rows and the Skills page its banners.
  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await first.press({ key: 'open:topic:Other' })
  await first.press({ key: 'sw:beta' })
  await first.select({ key: 'focus', value: 'topic:Video & motion' })
  await first.unmount()

  for (const surface of ['desktop', 'terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    // Skills: the focus banner, the suggestion (and its preview), usage, an open skill.
    await ui.press({ key: 'page:skills' })
    expect(await ui.find({ key: 'focus:end' }), surface).toBeDefined()
    expect(await ui.find({ key: 'suggest:never' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^used 3× / }), surface).toBeDefined()
    // A skill's details (Manage, at the end of each round, closes them again).
    await ui.press({ key: 'info:alpha' })
    expect(await ui.find({ key: 'level:alpha' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Here: 3 \(Claude 2, you 1\)/ }), surface).toBeDefined()
    await ui.press({ key: 'suggest:apply' })
    expect(await ui.find({ key: 'confirm:video-work' }), surface).toBeDefined()
    await ui.press({ key: 'cancel:video-work' })
    await ui.press({ key: 'show:unused' })
    expect(await ui.find({ type: 'Text', text: /^On here, but not used here/ }), surface).toBeDefined()
    await ui.press({ key: 'show:all' })
    if (surface === 'terminal') expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    else expect(await ui.find({ type: 'Svg' })).toBeDefined()

    // Profiles: a card with a rule, each of its steps, and a deleted one.
    await ui.press({ key: 'page:profiles' })
    expect(await ui.find({ key: 'rulesub:video-work|c:/proj' }), surface).toBeDefined()
    expect(await ui.find({ key: 'restore:old' }), surface).toBeDefined()
    await ui.press({ key: 'apply:video-work' })
    expect(await ui.find({ key: 'confirm:video-work' }), surface).toBeDefined()
    await ui.press({ key: 'cancel:video-work' })
    await ui.press({ key: 'renaming:video-work' })
    expect(await ui.find({ key: 'rename:video-work' }), surface).toBeDefined()
    await ui.press({ key: 'cancel:video-work' })
    await ui.press({ key: 'delete:video-work' })
    expect((await ui.find({ key: 'delete:video-work' }))?.props['label']).toBe('Sure? Delete')

    // Projects: cards with their bars, a copy preview, the usage line.
    await ui.press({ key: 'page:projects' })
    expect(await ui.find({ key: 'manage:c:/work/other' }), surface).toBeDefined()
    expect(await ui.find({ key: 'usage:clear' }), surface).toBeDefined()
    await ui.select({ key: 'copy:c:/proj', value: 'c:/work/other' })
    expect(await ui.find({ key: 'copy-yes:c:/proj' }), surface).toBeDefined()
    await ui.press({ key: 'copy-no:c:/proj' })
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /█|░/ })).toBeDefined()
    else expect(await ui.find({ type: 'Svg' })).toBeDefined()

    // History: rows that can be undone, in each view.
    await ui.press({ key: 'page:history' })
    await ui.select({ key: 'history:scope', value: 'all' })
    expect(await ui.find({ type: 'Text', text: /focus on "Video & motion" · this chat/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /"beta" off · proj/ }), surface).toBeDefined()
    await ui.select({ key: 'history:scope', value: 'folder' })

    // Another folder, managed from here.
    await ui.press({ key: 'page:projects' })
    await ui.press({ key: 'manage:c:/work/other' })
    expect(await ui.find({ key: 'target:back' }), surface).toBeDefined()
    await ui.press({ key: 'target:back' })
    await ui.unmount()
  }
})

test('Skills is the first page, and the other pages start empty with one plain line', SLOW, async ($, on) => {
  world(on)
  const ui = await openPanel($)
  expect((await ui.find({ key: 'page:skills' }))?.props['variant']).toBe('primary')

  await ui.press({ key: 'page:profiles' })
  expect(await ui.find({ type: 'Text', text: /^No profiles yet\./ })).toBeDefined()
  await ui.press({ key: 'page:history' })
  expect(await ui.find({ type: 'Text', text: /^No changes here yet\./ })).toBeDefined()
  await ui.unmount()
})

test('a view version 0.2 stored is declined: the panel opens on Skills with its defaults', SLOW, async ($, on) => {
  world(on)
  // What version 0.2 kept: no page, no History filter.
  on('state.get', { plugin: 'skills-panel', key: 'view' }, () => ({
    value: {
      shape: 'view-2',
      value: { scope: 'session', filter: 'zzz', show: 'off', groupBy: 'source', open: [], detail: null },
    } as never,
    version: 7,
  }))
  const ui = await openPanel($)
  expect((await ui.find({ key: 'page:skills' }))?.props['variant']).toBe('primary')
  expect((await ui.find({ key: 'show:all' }))?.props['variant']).toBe('primary')
  expect((await ui.find({ key: 'scope:project' }))?.props['variant']).toBe('primary')
  expect(await ui.find({ key: 'open:topic:Other' })).toBeDefined()
  await ui.unmount()
})

test('a skill list version 0.2 stored is declined: the panel reads the skills again', SLOW, async ($, on) => {
  world(on)
  let isOld = true
  // What version 0.2 kept for the folder: no `isOther`, and no `onLevels` in its settings view.
  on('state.get', { plugin: 'skills-panel', key: 'inventory' }, (_, e, next) =>
    isOld
      ? {
          value: {
            shape: 'inventory-2',
            value: { root: ROOT, project: 'proj', file: 'x', isHome: false, skills: [], plugins: [], budget: null },
          } as never,
          version: 4,
        }
      : next(e),
  )
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The old value is not drawn: the panel offers to load.
  expect(await ui.find({ key: 'load' })).toBeDefined()
  expect(await ui.find({ key: 'page:skills' })).toBeUndefined()
  isOld = false
  await ui.press({ key: 'load' })
  expect(await ui.find({ type: 'Text', text: /^Skills · proj$/ })).toBeDefined()
  await ui.unmount()
})
