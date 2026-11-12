// Usage: which skills are really used here. Counted on this computer only.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { USAGE_MAX_FOLDERS, began, counted, readUsage, usageView, usedChip, usedLine } from '../hooks/usage'
import { DAY, OTHER, PANE, ROOT, SLOW, openPanel, world } from './world'

const HERE = 'c:/proj'

/** The user typing `/name`. */
async function slash($: Engine, name: string) {
  return $.prompt.submit({ text: `/${name}`, command: { name, args: '' }, wait: false, origin: { kind: 'composer' } })
}

test('counts add up per folder, by who ran the skill, and the oldest folder goes when there are too many', () => {
  let store = readUsage(undefined)
  store = counted(store, HERE, 'alpha', 'claude', 1_000)
  store = counted(store, HERE, 'alpha', 'you', 2_000)
  store = counted(store, 'c:/other', 'alpha', 'claude', 3_000)
  expect(store.folders[HERE]).toEqual({ since: 1_000, skills: { alpha: { claude: 1, you: 1, last: 2_000 } } })

  const view = usageView(store, HERE, 5_000, { isTracking: true, unusedDays: 30 })
  expect(view.here).toEqual({ alpha: { claude: 1, you: 1, last: 2_000 } })
  expect(view.everywhere).toEqual({ alpha: 3 })
  expect(view.since).toBe(1_000)
  expect(usedChip({ claude: 3, you: 2, last: 5_000 - 2 * DAY }, 5_000)).toBe('used 5× · 2 days ago')
  expect(usedLine({ claude: 3, you: 2, last: 5_000 - 2 * DAY }, 12, 5_000)).toBe(
    'Here: 5 (Claude 3, you 2), last 2 days ago · All folders: 12',
  )
  expect(usedLine(undefined, 4, 5_000)).toBe('Not used here yet · All folders: 4')

  // Counting begins once per folder.
  expect(began(store, HERE, 9_000)).toBeNull()
  expect(began(store, 'c:/new', 9_000)?.folders['c:/new']).toEqual({ since: 9_000, skills: {} })

  // More folders than are kept: the one used longest ago is dropped.
  let full = readUsage(undefined)
  for (let i = 0; i <= USAGE_MAX_FOLDERS; i++) full = counted(full, `c:/p${i}`, 'alpha', 'claude', 1_000 + i)
  expect(Object.keys(full.folders)).toHaveLength(USAGE_MAX_FOLDERS)
  expect(full.folders['c:/p0']).toBeUndefined()
  expect(full.folders[`c:/p${USAGE_MAX_FOLDERS}`]).toBeDefined()

  // Anything broken in the store is left out.
  expect(readUsage({ version: 1, folders: { x: { since: 'soon', skills: { a: { claude: -2, you: 'no' }, b: 7 } } } })).toEqual({
    version: 1,
    folders: { x: { since: 0, skills: {} } },
  })
})

test('a Skill call that ran and a /name the user typed are each counted once; a failed or refused one is not', SLOW, async ($, on) => {
  const w = world(on)
  const ui = await openPanel($)

  await $.tool.call({ tool: 'Skill', skill: 'alpha' })
  await $.tool.call({ tool: 'Skill', skill: '/alpha' })
  await slash($, 'alpha')
  // Not counted: a command that is no skill, a skill that failed, a skill that is off for this chat.
  await slash($, 'clear')
  w.skillFails = true
  await $.tool.call({ tool: 'Skill', skill: 'gamma' })
  w.skillFails = false
  await ui.press({ key: 'scope:session' })
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:beta' })
  await $.tool.call({ tool: 'Skill', skill: 'beta' })
  expect((await slash($, 'beta')).drop).toContain('off for this session')

  expect(await ui.find({ type: 'Text', text: /^used 3× · just now$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^used / })).toHaveLength(1)
  await ui.press({ key: 'info:alpha' })
  expect((await ui.find({ type: 'Text', text: /^Here: / }))?.text).toBe(
    'Here: 3 (Claude 2, you 1), last just now · All folders: 3',
  )
  await ui.press({ key: 'info:gamma' })
  expect((await ui.find({ type: 'Text', text: /^Not used here yet/ }))?.text).toBe('Not used here yet · All folders: 0')
  await ui.unmount()
})

test('Unused lists what is on here but was not used here for the days set', SLOW, async ($, on) => {
  const now = 100 * DAY
  const w = world(on, {
    store: {
      usage: {
        version: 1,
        folders: {
          [HERE]: {
            since: now - 90 * DAY,
            skills: {
              alpha: { claude: 4, you: 0, last: now - 2 * DAY },
              beta: { claude: 1, you: 0, last: now - 45 * DAY },
            },
          },
          // Used in another folder: that does not count for this one.
          'c:/work/other': { since: now - 90 * DAY, skills: { gamma: { claude: 9, you: 0, last: now - DAY } } },
        },
      },
    },
  })
  w.files[`${ROOT}/.claude/settings.local.json`] = JSON.stringify({ permissions: { deny: ['Skill(cloudflare:wrangler)'] } })
  await w.clock.set(now)
  const ui = await openPanel($)

  // On and unused here: beta (45 days), gamma and the app skill (never). Not alpha (2 days), not wrangler (off).
  expect(await ui.find({ key: 'show:unused' })).toBeDefined()
  expect((await ui.find({ key: 'show:unused' }))?.props['label']).toBe('Unused 3')
  await ui.press({ key: 'show:unused' })
  expect(await ui.find({ key: 'sw:beta' })).toBeDefined()
  expect(await ui.find({ key: 'sw:gamma' })).toBeDefined()
  expect(await ui.find({ key: 'sw:anthropic-skills:pdf' })).toBeDefined()
  expect(await ui.find({ key: 'sw:alpha' })).toBeUndefined()
  expect(await ui.find({ key: 'sw:cloudflare:wrangler' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^On here, but not used here in the last 30 days\. Counting began 3 months ago\.$/ })).toBeDefined()

  // All folders: gamma was used elsewhere.
  await ui.press({ key: 'info:gamma' })
  expect((await ui.find({ type: 'Text', text: /^Not used here yet/ }))?.text).toBe('Not used here yet · All folders: 9')
  await ui.unmount()
})

test('the unused line shows only once counting has run here for the days set, and from ten skills', SLOW, async ($, on) => {
  const w = world(on, { many: 10 })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  // The first session here: counting begins now.
  await w.clock.advance(1_000)
  await w.clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'unused:show' })).toBeUndefined()
  // On day one nothing is called unused: no skill can have gone 30 days without use yet.
  expect((await ui.find({ key: 'show:unused' }))?.props['label']).toBe('Unused 0')
  await ui.press({ key: 'show:unused' })
  expect((await ui.find({ type: 'Text', text: /^On here, but not used here/ }))?.text).toBe(
    'On here, but not used here in the last 30 days. Counting began just now, so skills show up here once 30 days have passed.',
  )
  await ui.press({ key: 'show:all' })

  await w.clock.advance(29 * DAY)
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'unused:show' })).toBeUndefined()
  expect((await ui.find({ key: 'show:unused' }))?.props['label']).toBe('Unused 0')

  await w.clock.advance(2 * DAY)
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ key: 'show:unused' }))?.props['label']).toBe('Unused 15')
  expect((await ui.find({ type: 'Text', text: /on but unused here/ }))?.text).toBe(
    '15 skills are on but unused here for 30 days.',
  )
  // It only suggests: pressing it shows them, and nothing is switched.
  await ui.press({ key: 'unused:show' })
  expect((await ui.find({ key: 'show:unused' }))?.props['variant']).toBe('primary')
  expect(w.files[`${ROOT}/.claude/settings.local.json`]).toBeUndefined()

  // A skill used now leaves the list.
  await $.tool.call({ tool: 'Skill', skill: 'alpha' })
  expect((await ui.find({ key: 'show:unused' }))?.props['label']).toBe('Unused 14')
  await ui.unmount()
})

test('fewer than ten unused skills: no line, however long counting has run', SLOW, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  await w.clock.advance(60 * DAY)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ key: 'show:unused' }))?.props['label']).toBe('Unused 5')
  expect(await ui.find({ key: 'unused:show' })).toBeUndefined()
  await ui.unmount()
})

test('the days can be set: with unusedDays 7 the line shows after a week', { ...SLOW, options: { unusedDays: 7 } }, async ($, on) => {
  const w = world(on, { many: 10 })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  await w.clock.advance(8 * DAY)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Text', text: /on but unused here/ }))?.text).toBe(
    '15 skills are on but unused here for 7 days.',
  )
  await ui.unmount()
})

test('Clear usage data asks once more, then removes every count', SLOW, async ($, on) => {
  world(on, {
    store: {
      usage: {
        version: 1,
        folders: {
          [HERE]: { since: 1, skills: { alpha: { claude: 4, you: 1, last: 900 } } },
          'c:/work/other': { since: 1, skills: { alpha: { claude: 2, you: 0, last: 900 } } },
        },
      },
    },
  })
  const ui = await openPanel($)
  await ui.press({ key: 'open:topic:Other' })
  expect(await ui.find({ type: 'Text', text: /^used 5× / })).toBeDefined()

  await ui.press({ key: 'page:projects' })
  await ui.press({ key: 'usage:clear' })
  expect((await ui.find({ key: 'usage:clear' }))?.props['label']).toBe('Sure? Clear')
  await ui.press({ key: 'page:skills' })
  // Leaving the page takes the question back: nothing was cleared.
  expect(await ui.find({ type: 'Text', text: /^used 5× / })).toBeDefined()

  await ui.press({ key: 'page:projects' })
  expect((await ui.find({ key: 'usage:clear' }))?.props['label']).toBe('Clear usage data')
  await ui.press({ key: 'usage:clear' })
  await ui.press({ key: 'usage:clear' })
  expect(await ui.find({ type: 'Text', text: /^Usage data cleared\./ })).toBeDefined()
  await ui.press({ key: 'page:skills' })
  expect(await ui.find({ type: 'Text', text: /^used / })).toBeUndefined()
  await ui.press({ key: 'info:alpha' })
  expect((await ui.find({ type: 'Text', text: /^Not used here yet/ }))?.text).toBe('Not used here yet · All folders: 0')
  await ui.unmount()
})

test('with trackUsage off nothing is counted and nothing about usage is shown', { ...SLOW, options: { trackUsage: false } }, async ($, on) => {
  const w = world(on, { many: 10 })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  await $.tool.call({ tool: 'Skill', skill: 'alpha' })
  await slash($, 'alpha')
  await w.clock.advance(60 * DAY)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'open:topic:Other' })
  expect(await ui.find({ type: 'Text', text: /^used / })).toBeUndefined()
  expect(await ui.find({ key: 'show:unused' })).toBeUndefined()
  expect(await ui.find({ key: 'unused:show' })).toBeUndefined()
  await ui.press({ key: 'info:alpha' })
  expect(await ui.find({ type: 'Text', text: /All folders/ })).toBeUndefined()
  await ui.press({ key: 'page:projects' })
  expect(await ui.find({ key: 'usage:clear' })).toBeUndefined()
  await ui.unmount()
})

test('counts are kept per folder: a skill used in one folder is unused in another', SLOW, async ($, on) => {
  const w = world(on)
  const first = await openPanel($)
  await $.tool.call({ tool: 'Skill', skill: 'alpha' })
  await first.unmount()

  // A session in the other folder: alpha has no count there, and one in all folders.
  w.root = OTHER
  w.sessionId = 's2'
  await $.session.start({ cwd: OTHER, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'open:topic:Other' })
  expect(await ui.find({ type: 'Text', text: /^used / })).toBeUndefined()
  await ui.press({ key: 'info:alpha' })
  expect((await ui.find({ type: 'Text', text: /^Not used here yet/ }))?.text).toBe('Not used here yet · All folders: 1')
  await ui.unmount()
})
