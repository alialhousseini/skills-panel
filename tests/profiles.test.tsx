// Profiles: save a setup once, reuse it anywhere.
import { expect, test } from 'claude-code/testing'

import { planProject, planSession, profileId, profileSummary, projectPlanText, readProfiles } from '../hooks/profiles'
import type { SkillRow } from '../types'
import { LOCAL, OTHER_LOCAL, SLOW, local, openPanel, shows, world } from './world'

const row = (id: string, kind: SkillRow['kind'] = 'global'): SkillRow => ({
  id,
  kind,
  group: kind,
  description: '',
  isManual: false,
  note: null,
  tokens: null,
})

/** A stored profile, as an earlier session saved it. */
const stored = (profile: Record<string, unknown>) => ({
  profiles: {
    version: 1,
    items: [{ folders: [], levels: {}, off: [], createdAt: 1, updatedAt: 1, ...profile }],
    deleted: [],
  },
})

test('a profile id comes from its name, and a taken one gets a number', () => {
  expect(profileId('Video work', new Set())).toBe('video-work')
  expect(profileId('Video work', new Set(['video-work']))).toBe('video-work-2')
  expect(profileId('Video work', new Set(['video-work', 'video-work-2']))).toBe('video-work-3')
  expect(profileId('!!!', new Set())).toBe('profile')
})

test('the plan makes a folder match the profile, and counts what it cannot do', () => {
  const rows = [row('alpha'), row('beta'), row('gamma'), row('locked'), row('cloudflare:wrangler', 'plugin')]
  const plan = planProject(
    { off: ['alpha', 'ghost', 'locked'], levels: { gamma: 'name-only', phantom: 'user-invocable-only' } },
    rows,
    {
      off: ['beta', 'cloudflare:wrangler'],
      levels: {},
      locked: { locked: 'set by managed policy' },
      onLevels: {},
    },
  )

  expect(plan.targets).toEqual([
    { id: 'alpha', level: 'off' },
    { id: 'beta', level: 'on' },
    { id: 'gamma', level: 'name-only' },
    { id: 'cloudflare:wrangler', level: 'on' },
  ])
  expect([plan.off, plan.on, plan.nameOnly, plan.onlyYou]).toEqual([1, 2, 1, 0])
  expect(plan.skipped).toBe(2)
  expect(plan.locked).toBe(1)
  expect(projectPlanText(plan, 'proj')).toBe(
    "Turns 1 off, 2 on, 1 to name only in proj. 2 skills in it aren't installed here (skipped). 1 skill locked by other settings stay as they are.",
  )
})

test('"on" means what the settings below give: a skill that is name only everywhere stays name only', () => {
  const plan = planProject({ off: [], levels: {} }, [row('alpha')], {
    off: [],
    levels: { alpha: 'name-only' },
    locked: {},
    onLevels: { alpha: 'name-only' },
  })
  expect(plan.targets).toEqual([])
})

test('a session takes the off list, less what the project already has off; levels do not apply', () => {
  const plan = planSession(
    { off: ['alpha', 'beta', 'ghost'] },
    [row('alpha'), row('beta'), row('gamma')],
    new Set(['beta']),
    new Set(['gamma']),
  )
  expect(plan).toEqual({ turnOff: ['alpha'], turnOn: ['gamma'], skipped: 1 })
})

test('stored profiles are read back with anything broken left out', () => {
  expect(readProfiles(undefined)).toEqual({ items: [], deleted: [] })
  expect(readProfiles({ version: 2, items: [{ id: 'a', name: 'A' }] })).toEqual({ items: [], deleted: [] })
  const read = readProfiles({
    version: 1,
    items: [{ id: 'a', name: 'A', off: ['x', 7], levels: { y: 'name-only', z: 'off' }, folders: [{ path: 'C:/p' }, {}] }, 'junk'],
    deleted: [],
  })
  expect(read.items).toHaveLength(1)
  expect(read.items[0]).toMatchObject({
    id: 'a',
    off: ['x'],
    levels: { y: 'name-only' },
    folders: [{ path: 'C:/p', withSubfolders: true }],
  })
  expect(profileSummary({ off: ['x'], levels: { y: 'name-only', z: 'user-invocable-only' } })).toBe(
    '1 off · 1 name only · 1 only you',
  )
})

test('Save keeps this folder\'s setup; Apply shows a preview first, and one Undo puts the file back exactly', SLOW, async ($, on) => {
  const w = world(on)
  const ui = await openPanel($)

  // A setup worth saving: alpha off, gamma name only.
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:alpha' })
  await ui.press({ key: 'info:gamma' })
  await ui.select({ key: 'level:gamma', value: 'name-only' })

  await ui.press({ key: 'page:profiles' })
  expect(await ui.find({ type: 'Text', text: /keeps what is set now for proj: 1 off · 1 name only/ })).toBeDefined()
  await ui.input({ key: 'profile:new', text: '  Video   work ' })
  expect(await ui.find({ type: 'Text', text: /^Video work$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Saved "Video work": 1 off · 1 name only\.$/ })).toBeDefined()
  // The same name again is refused, with what to do instead.
  await ui.input({ key: 'profile:new', text: 'video work' })
  expect(await ui.find({ type: 'Text', text: /already exists/ })).toBeDefined()

  // Change the folder to something else: all back to default, then beta and a plugin skill off.
  await ui.press({ key: 'page:skills' })
  await ui.press({ key: 'show:changed' })
  await ui.press({ key: 'reset' })
  await ui.press({ key: 'show:all' })
  await ui.press({ key: 'sw:beta' })
  await ui.press({ key: 'open:topic:Apps & code' })
  await ui.press({ key: 'sw:cloudflare:wrangler' })
  const before = w.files[LOCAL]
  expect(local(w)).toEqual({ skillOverrides: { beta: 'off' }, permissions: { deny: ['Skill(cloudflare:wrangler)'] } })

  // Apply: nothing is written until the preview is confirmed.
  await ui.press({ key: 'page:profiles' })
  await ui.press({ key: 'apply:video-work' })
  expect((await ui.find({ type: 'Text', text: /^Turns / }))?.text).toBe('Turns 1 off, 2 on, 1 to name only in proj.')
  expect(w.files[LOCAL]).toBe(before)
  await ui.press({ key: 'cancel:video-work' })
  expect(await ui.find({ key: 'confirm:video-work' })).toBeUndefined()
  expect(w.files[LOCAL]).toBe(before)

  await ui.press({ key: 'apply:video-work' })
  await ui.press({ key: 'confirm:video-work' })
  expect(local(w)).toEqual({ skillOverrides: { gamma: 'name-only', alpha: 'off' } })
  expect(await ui.find({ type: 'Text', text: /^"Video work" applied to proj: 4 skills changed\.$/ })).toBeDefined()

  // Claude hears of what changed for it, once.
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  const note = w.submitted[0]?.context.join('\n') ?? ''
  expect(note).toContain('Now OFF for this project:\n- alpha')
  expect(note).toContain('Now ON again for this project:\n- beta')

  // One Undo for the whole Apply.
  expect((await ui.find({ type: 'Text', text: /^Last change: / }))?.text).toBe(
    'Last change: profile "Video work" applied (this project)',
  )
  await ui.press({ key: 'undo' })
  expect(w.files[LOCAL]).toBe(before)
  await ui.unmount()
})

test('Apply to this session: the off list is used, levels are not, and no file is written', SLOW, async ($, on) => {
  const w = world(on, { store: stored({ id: 'video-work', name: 'Video work', off: ['alpha', 'gamma'], levels: { beta: 'name-only' } }) })
  w.files[LOCAL] = JSON.stringify({ skillOverrides: { gamma: 'off' } })
  const before = w.files[LOCAL]
  const ui = await openPanel($)

  await ui.press({ key: 'page:profiles' })
  await ui.press({ key: 'scope:session' })
  await ui.press({ key: 'apply:video-work' })
  // gamma is off for the project already, so only alpha is left to switch.
  expect((await ui.find({ type: 'Text', text: /^Turns / }))?.text).toBe(
    'Turns 1 off for this chat. Levels are ignored for a chat.',
  )
  await ui.press({ key: 'confirm:video-work' })
  expect(w.files[LOCAL]).toBe(before)
  expect((await $.tool.call({ tool: 'Skill', skill: 'alpha' })).deny).toContain('switched off for this session')
  expect((await $.tool.call({ tool: 'Skill', skill: 'beta' })).deny).toBeUndefined()

  // One Undo takes the whole Apply back.
  await ui.press({ key: 'undo' })
  expect((await $.tool.call({ tool: 'Skill', skill: 'alpha' })).deny).toBeUndefined()
  await ui.unmount()
})

test('Save from a session keeps everything that is off in this chat', SLOW, async ($, on) => {
  const w = world(on)
  w.files[LOCAL] = JSON.stringify({ skillOverrides: { alpha: 'off' } })
  const ui = await openPanel($)
  await ui.press({ key: 'scope:session' })
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:gamma' })

  await ui.press({ key: 'page:profiles' })
  expect(await ui.find({ type: 'Text', text: /keeps what is set now for this chat: 2 off · 0 name only/ })).toBeDefined()
  await ui.input({ key: 'profile:new', text: 'Quiet' })
  expect(await ui.find({ type: 'Text', text: /^Saved "Quiet": 2 off · 0 name only\.$/ })).toBeDefined()

  // Applied to the project, it makes the folder match: gamma goes off there too.
  await ui.press({ key: 'scope:project' })
  await ui.press({ key: 'apply:quiet' })
  expect((await ui.find({ type: 'Text', text: /^Turns / }))?.text).toBe('Turns 1 off in proj.')
  await ui.press({ key: 'confirm:quiet' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off', gamma: 'off' } })
  await ui.unmount()
})

test('Update needs a second press, then holds the setup as it is now', SLOW, async ($, on) => {
  const w = world(on, { store: stored({ id: 'work', name: 'Work', off: ['alpha'] }) })
  w.files[LOCAL] = JSON.stringify({ skillOverrides: { gamma: 'off', beta: 'name-only' } })
  const ui = await openPanel($)
  await ui.press({ key: 'page:profiles' })
  expect(await ui.find({ type: 'Text', text: /^1 off · 0 name only$/ })).toBeDefined()

  await ui.press({ key: 'update:work' })
  expect(await shows(ui, 'update:work')).toBe('Sure? Update')
  expect(await ui.find({ type: 'Text', text: /^1 off · 0 name only$/ })).toBeDefined()
  await ui.press({ key: 'update:work' })
  expect(await shows(ui, 'update:work')).toBe('Update')
  expect(await ui.find({ type: 'Text', text: /^1 off · 1 name only$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^"Work" now holds this setup/ })).toBeDefined()
  await ui.unmount()
})

test('Rename, Delete (after "Sure?") and Restore; the last five deleted stay restorable', SLOW, async ($, on) => {
  world(on, { store: stored({ id: 'video-work', name: 'Video work', off: ['alpha'] }) })
  const ui = await openPanel($)
  await ui.press({ key: 'page:profiles' })

  await ui.press({ key: 'renaming:video-work' })
  await ui.input({ key: 'rename:video-work', text: ' Film ' })
  expect(await ui.find({ type: 'Text', text: /^Film$/ })).toBeDefined()
  expect(await ui.find({ key: 'rename:video-work' })).toBeUndefined()

  // The first press only asks.
  await ui.press({ key: 'delete:video-work' })
  expect(await shows(ui, 'delete:video-work')).toBe('Sure? Delete')
  expect(await ui.find({ key: 'apply:video-work' })).toBeDefined()
  await ui.press({ key: 'delete:video-work' })
  expect(await ui.find({ key: 'apply:video-work' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Film · 1 off · 0 name only$/ })).toBeDefined()

  await ui.press({ key: 'restore:video-work' })
  expect(await ui.find({ key: 'apply:video-work' })).toBeDefined()
  expect(await ui.find({ key: 'restore:video-work' })).toBeUndefined()

  // Six more made and deleted: only the last five can come back.
  for (const name of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) {
    await ui.input({ key: 'profile:new', text: name })
    await ui.press({ key: `delete:${name}` })
    await ui.press({ key: `delete:${name}` })
  }
  const restorable = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('restore:'))
  expect(restorable).toEqual(['restore:a6', 'restore:a5', 'restore:a4', 'restore:a3', 'restore:a2'])
  await ui.unmount()
})

test('a profile that lists skills not installed here skips them, and says how many', SLOW, async ($, on) => {
  const w = world(on, {
    store: stored({ id: 'old', name: 'Old', off: ['alpha', 'ghost'], levels: { phantom: 'name-only' } }),
  })
  const ui = await openPanel($)
  await ui.press({ key: 'page:profiles' })
  await ui.press({ key: 'apply:old' })
  expect((await ui.find({ type: 'Text', text: /^Turns / }))?.text).toBe(
    "Turns 1 off in proj. 2 skills in it aren't installed here (skipped).",
  )
  await ui.press({ key: 'confirm:old' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off' } })

  // Applied again there is nothing to change, and nothing to confirm.
  await ui.press({ key: 'apply:old' })
  expect((await ui.find({ type: 'Text', text: /already matches it/ }))?.text).toContain('proj already matches it.')
  expect(await ui.find({ key: 'confirm:old' })).toBeUndefined()
  await ui.unmount()
})

test('Apply to another folder writes that folder only, and its Undo is there', SLOW, async ($, on) => {
  const w = world(on, { store: stored({ id: 'work', name: 'Work', off: ['alpha', 'delta', 'gamma'] }) })
  const ui = await openPanel($)
  await ui.press({ key: 'page:projects' })
  await ui.press({ key: 'manage:c:/work/other' })

  await ui.press({ key: 'page:profiles' })
  expect(await ui.find({ key: 'scope:session' })).toBeUndefined()
  await ui.press({ key: 'apply:work' })
  // gamma is this session's folder's own skill: the other folder does not have it.
  expect((await ui.find({ type: 'Text', text: /^Turns / }))?.text).toBe(
    "Turns 2 off in other. 1 skill in it isn't installed here (skipped).",
  )
  await ui.press({ key: 'confirm:work' })
  expect(local(w, OTHER_LOCAL)).toEqual({ skillOverrides: { delta: 'off', alpha: 'off' } })
  expect(w.files[LOCAL]).toBeUndefined()

  // This chat's Claude is not told: its own folder did not change.
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[0]?.context).toEqual([])

  await ui.press({ key: 'undo' })
  expect(local(w, OTHER_LOCAL)).toEqual({})
  await ui.unmount()
})
