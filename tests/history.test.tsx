// History: see what changed, undo any of it.
import { expect, test } from 'claude-code/testing'

import { JOURNAL_MAX, JOURNAL_MAX_OPS, historyRows, nextAt, trimJournal, undoStates } from '../hooks/history'
import { ago } from '../hooks/lib'
import type { JournalEntry, Op } from '../types'
import { LOCAL, OTHER, OTHER_LOCAL, ROOT, SLOW, local, openPanel, world } from './world'

const off = (id: string): Op => ({ kind: 'override', id, before: null, after: 'off' })

function entry(at: number, ops: Op[], more: Partial<JournalEntry> = {}): JournalEntry {
  return { at, scope: 'project', root: ROOT, file: LOCAL, sessionId: 's1', label: `change ${at} (this project)`, ops, ...more }
}

test('time is told in plain words', () => {
  expect(ago(20_000)).toBe('just now')
  expect(ago(3 * 60_000)).toBe('3 min ago')
  expect(ago(60 * 60_000)).toBe('1 hour ago')
  expect(ago(2 * 24 * 60 * 60_000)).toBe('2 days ago')
  expect(ago(90 * 24 * 60 * 60_000)).toBe('3 months ago')
})

test('the journal keeps 500 changes, fewer when they are large, and never loses the newest', () => {
  const many = Array.from({ length: JOURNAL_MAX + 40 }, (_, i) => entry(i + 1, [off('alpha')]))
  const kept = trimJournal(many)
  expect(kept).toHaveLength(JOURNAL_MAX)
  expect(kept[kept.length - 1]?.at).toBe(JOURNAL_MAX + 40)

  // Large changes (a focus over hundreds of skills) are held to a total size.
  const large = Array.from({ length: 100 }, (_, i) =>
    entry(i + 1, Array.from({ length: 300 }, (_, n) => off(`skill-${n}`))),
  )
  const fewer = trimJournal(large)
  expect(fewer.reduce((sum, one) => sum + one.ops.length, 0)).toBeLessThanOrEqual(JOURNAL_MAX_OPS)
  expect(fewer[fewer.length - 1]?.at).toBe(100)
  expect(trimJournal([entry(1, Array.from({ length: JOURNAL_MAX_OPS + 5 }, (_, n) => off(`s-${n}`)))])).toHaveLength(1)

  // No two entries share a time: it names the entry.
  expect(nextAt([entry(1000, [])], 1000)).toBe(1001)
  expect(nextAt([entry(1000, [])], 5000)).toBe(5000)
})

test('an entry can be undone unless a newer one touched the same skill in the same place', () => {
  const journal = [
    entry(1, [off('alpha')]),
    entry(2, [off('beta')]),
    entry(3, [{ kind: 'override', id: 'alpha', before: 'off', after: null }]),
    // The same skill, but another folder's file: it stands in nobody's way.
    entry(4, [off('beta')], { root: OTHER, file: OTHER_LOCAL }),
    entry(5, [{ kind: 'session', id: 'beta', before: false, after: true }], { scope: 'session', file: '' }),
    entry(6, [{ kind: 'session', id: 'gamma', before: false, after: true }], { scope: 'session', file: '', sessionId: 's0' }),
  ]
  expect(undoStates(journal, 's1')).toEqual(['later', 'undo', 'undo', 'undo', 'undo', 'away'])

  const everywhere = historyRows(journal, { scope: 'all', root: ROOT, sessionId: 's1', now: 10 })
  expect(everywhere.rows.map(row => row.where)).toEqual(['another chat', 'this chat', 'other', 'proj', 'proj', 'proj'])
  const here = historyRows(journal, { scope: 'folder', root: ROOT, sessionId: 's1', now: 10 })
  expect(here.rows.map(row => row.at)).toEqual([3, 2, 1])
  expect(here.rows.map(row => row.where)).toEqual(['this project', 'this project', 'this project'])
  expect(historyRows(journal, { scope: 'chat', root: ROOT, sessionId: 's1', now: 10 }).rows.map(row => row.at)).toEqual([5])
})

test('History lists the changes, newest first, and undoes an older one without touching the rest', SLOW, async ($, on) => {
  const w = world(on)
  const ui = await openPanel($)
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:alpha' })
  await ui.press({ key: 'sw:gamma' })
  await ui.press({ key: 'open:topic:Apps & code' })
  await ui.press({ key: 'sw:cloudflare:wrangler' })
  await w.clock.advance(3 * 60_000)

  await ui.press({ key: 'page:history' })
  const lines = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('undo:'))
  expect(lines).toEqual(['undo:1002', 'undo:1001', 'undo:1000'])
  expect(await ui.find({ type: 'Text', text: /3 min ago · "alpha" off · this project/ })).toBeDefined()

  // The oldest change, while two newer ones stay.
  await ui.press({ key: 'undo:1000' })
  expect(local(w)).toEqual({ skillOverrides: { gamma: 'off' }, permissions: { deny: ['Skill(cloudflare:wrangler)'] } })
  expect(await ui.find({ key: 'undo:1000' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Undone: "alpha" off \(this project\)\.$/ })).toBeDefined()

  // Claude hears that alpha is back.
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[0]?.context.join('\n')).toContain('Now ON again for this project:\n- alpha')
  await ui.unmount()
})

test('Undo is blocked while a newer change to the same skill stands, and opens once that one is undone', SLOW, async ($, on) => {
  const w = world(on)
  const ui = await openPanel($)
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'info:alpha' })
  await ui.select({ key: 'level:alpha', value: 'name-only' })
  await ui.press({ key: 'sw:alpha' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off' } })

  await ui.press({ key: 'page:history' })
  expect(await ui.find({ key: 'undo:1001' })).toBeDefined()
  expect(await ui.find({ key: 'undo:1000' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^changed later$/ })).toBeDefined()

  await ui.press({ key: 'undo:1001' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'name-only' } })
  expect(await ui.find({ type: 'Text', text: /^changed later$/ })).toBeUndefined()
  await ui.press({ key: 'undo:1000' })
  expect(local(w)).toEqual({})
  expect(await ui.find({ type: 'Text', text: /^No changes here yet\./ })).toBeDefined()
  await ui.unmount()
})

test('This chat lists this session\'s switches; another chat\'s are shown but cannot be undone here', SLOW, async ($, on) => {
  const w = world(on, {
    store: {
      journal: [
        entry(500, [{ kind: 'session', id: 'beta', before: false, after: true }], {
          scope: 'session',
          file: '',
          sessionId: 's0',
          label: '"beta" off (this session)',
        }),
      ],
    },
  })
  const ui = await openPanel($)
  await ui.press({ key: 'scope:session' })
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:gamma' })

  // History follows the scope picked on the Skills page: this chat.
  await ui.press({ key: 'page:history' })
  expect((await ui.find({ key: 'history:scope' }))?.props['value']).toBe('chat')
  expect(await ui.find({ type: 'Text', text: /"gamma" off · this chat/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /"beta" off/ })).toBeUndefined()

  await ui.select({ key: 'history:scope', value: 'all' })
  expect(await ui.find({ type: 'Text', text: /"beta" off · another chat/ })).toBeDefined()
  expect(await ui.find({ key: 'undo:500' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^another chat$/ })).toBeDefined()

  await ui.press({ key: 'undo:1000' })
  expect((await $.tool.call({ tool: 'Skill', skill: 'gamma' })).deny).toBeUndefined()
  expect(w.files[LOCAL]).toBeUndefined()
  await ui.unmount()
})

test('Everywhere names each change\'s folder, and its Undo writes that folder\'s file', SLOW, async ($, on) => {
  const w = world(on, {
    store: {
      journal: [entry(500, [off('delta')], { root: OTHER, file: OTHER_LOCAL, sessionId: 's0', label: '"delta" off (this project)' })],
    },
  })
  w.files[OTHER_LOCAL] = JSON.stringify({ skillOverrides: { delta: 'off' }, model: 'opus' })
  const ui = await openPanel($)
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:alpha' })

  await ui.press({ key: 'page:history' })
  // This folder: the other folder's change is not listed.
  expect((await ui.find({ key: 'history:scope' }))?.props['value']).toBe('folder')
  expect(await ui.find({ key: 'undo:500' })).toBeUndefined()

  await ui.select({ key: 'history:scope', value: 'all' })
  expect(await ui.find({ type: 'Text', text: /"delta" off · other/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /"alpha" off · proj/ })).toBeDefined()

  await ui.press({ key: 'undo:500' })
  expect(local(w, OTHER_LOCAL)).toEqual({ model: 'opus' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off' } })
  // This chat's Claude is not told about another folder.
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[0]?.context.join('\n')).not.toContain('delta')
  await ui.unmount()
})

test('History shows the newest 50 and says how many there are', SLOW, async ($, on) => {
  world(on, { store: { journal: Array.from({ length: 60 }, (_, i) => entry(i + 1, [off(`skill-${i}`)])) } })
  const ui = await openPanel($)
  await ui.press({ key: 'page:history' })
  const buttons = (await ui.findAll({ type: 'Button' })).filter(button => (button.key ?? '').startsWith('undo:'))
  expect(buttons).toHaveLength(50)
  expect(buttons[0]?.key).toBe('undo:60')
  expect(await ui.find({ type: 'Text', text: /^The newest 50 of 60\./ })).toBeDefined()
  await ui.unmount()
})
