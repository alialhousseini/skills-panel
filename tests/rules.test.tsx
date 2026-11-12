// Folder rules: open a folder, get the right profile suggested. Never applied by itself.
import { expect, test } from 'claude-code/testing'

import { matchRules } from '../hooks/profiles'
import type { FolderRule, Profile } from '../types'
import { LOCAL, OTHER, OTHER_LOCAL, PANE, ROOT, SLOW, local, openPanel, shows, world } from './world'

const TOAST = 'This folder usually uses "Video work". Open /skills-panel to apply.'

function profile(id: string, name: string, off: string[], folders: FolderRule[]): Profile {
  return { id, name, off, levels: {}, folders, createdAt: 1, updatedAt: 1 }
}

/** A store holding these profiles, as earlier sessions saved them. */
const saved = (...items: Profile[]) => ({ profiles: { version: 1, items, deleted: [] } })

const VIDEO = profile('video-work', 'Video work', ['alpha'], [{ path: ROOT, withSubfolders: true }])

test('a rule covers its folder, and the folders below it when it says so; the deepest rule comes first', () => {
  const wide = profile('wide', 'Wide', [], [{ path: 'C:\\Work', withSubfolders: true }])
  const narrow = profile('narrow', 'Narrow', [], [{ path: 'C:/work/site/', withSubfolders: true }])
  const exact = profile('exact', 'Exact', [], [{ path: 'C:/work', withSubfolders: false }])
  const ids = (here: string) => matchRules([wide, narrow, exact], here).map(one => one.id)

  expect(ids('c:/work')).toEqual(['wide', 'exact'])
  expect(ids('c:/work/site')).toEqual(['narrow', 'wide'])
  expect(ids('c:/work/site/app')).toEqual(['narrow', 'wide'])
  // A folder whose name merely starts the same is not below it.
  expect(ids('c:/workshop')).toEqual([])
  expect(ids('c:/elsewhere')).toEqual([])
})

test('at session start a rule suggests its profile: one toast, a banner, and Apply only after a preview', SLOW, async ($, on) => {
  const w = world(on, { store: saved(VIDEO) })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  await w.clock.settle()
  expect(w.toasts).toEqual([TOAST])
  // Nothing is applied by itself.
  expect(w.files[LOCAL]).toBeUndefined()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Suggested for this folder: / })).toBeDefined()
  expect(await ui.find({ key: 'suggest:later' })).toBeDefined()
  expect(await ui.find({ key: 'suggest:never' })).toBeDefined()

  // Apply shows what would change first; Cancel goes back to the suggestion.
  await ui.press({ key: 'suggest:apply' })
  expect((await ui.find({ type: 'Text', text: /^Video work: / }))?.text).toBe('Video work: Turns 1 off in proj.')
  expect(w.files[LOCAL]).toBeUndefined()
  await ui.press({ key: 'cancel:video-work' })
  expect(await ui.find({ key: 'suggest:apply' })).toBeDefined()
  expect(w.files[LOCAL]).toBeUndefined()

  await ui.press({ key: 'suggest:apply' })
  await ui.press({ key: 'confirm:video-work' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off' } })
  // The folder matches now: the suggestion is gone, and Undo brings both back.
  expect(await ui.find({ key: 'suggest:apply' })).toBeUndefined()
  await ui.press({ key: 'undo' })
  expect(local(w)).toEqual({})
  expect(await ui.find({ key: 'suggest:apply' })).toBeDefined()

  // The panel reloading in the same session does not toast again.
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  expect(w.toasts).toEqual([TOAST])
  await ui.unmount()
})

test('the suggestion is about the folder even while "This session" is picked', SLOW, async ($, on) => {
  const w = world(on, { store: saved(VIDEO) })
  const ui = await openPanel($)
  await ui.press({ key: 'scope:session' })
  await ui.press({ key: 'suggest:apply' })
  await ui.press({ key: 'confirm:video-work' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off' } })
  await ui.unmount()
})

test('no toast and no banner when the folder already matches the profile', SLOW, async ($, on) => {
  const w = world(on, { store: saved(VIDEO) })
  w.files[LOCAL] = JSON.stringify({ skillOverrides: { alpha: 'off' } })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  expect(w.toasts).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'suggest:apply' })).toBeUndefined()

  // Once the folder differs again, the banner is back (but never a toast in mid-session).
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:alpha' })
  expect(await ui.find({ key: 'suggest:apply' })).toBeDefined()
  expect(w.toasts).toEqual([])
  await ui.unmount()
})

test('a rule on a folder above covers a subfolder, and the deepest rule wins', SLOW, async ($, on) => {
  const wide = profile('wide', 'Wide', ['alpha'], [{ path: 'C:/work', withSubfolders: true }])
  const narrow = profile('narrow', 'Narrow', ['beta'], [{ path: OTHER, withSubfolders: true }])
  const w = world(on, { store: saved(wide, narrow) })
  w.root = OTHER
  await $.session.start({ cwd: OTHER, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  expect(w.toasts).toEqual(['This folder usually uses "Narrow". Open /skills-panel to apply.'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'suggest:apply' })
  await ui.press({ key: 'confirm:narrow' })
  expect(local(w, OTHER_LOCAL)).toEqual({ skillOverrides: { beta: 'off' } })
  // The deepest rule is satisfied: the one above it is not offered in its place.
  expect(await ui.find({ key: 'suggest:apply' })).toBeUndefined()
  await ui.unmount()
})

test('a rule without subfolders covers its own folder only', SLOW, async ($, on) => {
  const w = world(on, { store: saved(profile('wide', 'Wide', ['alpha'], [{ path: 'C:/work', withSubfolders: false }])) })
  w.root = OTHER
  await $.session.start({ cwd: OTHER, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  expect(w.toasts).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'suggest:apply' })).toBeUndefined()
  await ui.unmount()
})

test('"Not now" lasts for this session only; "Never here" lasts', SLOW, async ($, on) => {
  const w = world(on, { store: saved(VIDEO) })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await first.press({ key: 'suggest:later' })
  expect(await first.find({ key: 'suggest:apply' })).toBeUndefined()
  // Still this session: it stays away, whatever is refreshed or switched.
  await first.press({ key: 'refresh' })
  await first.press({ key: 'open:topic:Other' })
  await first.press({ key: 'sw:gamma' })
  expect(await first.find({ key: 'suggest:apply' })).toBeUndefined()
  await first.unmount()

  // A new session in the folder: suggested again.
  w.sessionId = 's2'
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  expect(w.toasts).toEqual([TOAST, TOAST])
  const second = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await second.find({ key: 'suggest:apply' })).toBeDefined()
  await second.press({ key: 'suggest:never' })
  expect(await second.find({ key: 'suggest:apply' })).toBeUndefined()
  expect(await second.find({ type: 'Text', text: /will not be suggested in this folder again/ })).toBeDefined()
  await second.unmount()

  // Every later session: never again, here.
  w.sessionId = 's3'
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  expect(w.toasts).toEqual([TOAST, TOAST])
  const third = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await third.find({ key: 'suggest:apply' })).toBeUndefined()
  // Nothing was ever applied along the way.
  expect(local(w)).toEqual({ skillOverrides: { gamma: 'off' } })
  await third.unmount()
})

test('"Never here" is for one folder: the same profile is still suggested elsewhere', SLOW, async ($, on) => {
  const both = profile('video-work', 'Video work', ['alpha'], [
    { path: ROOT, withSubfolders: true },
    { path: OTHER, withSubfolders: true },
  ])
  const w = world(on, { store: { ...saved(both), 'rule-dismissed': { 'c:/proj|video-work': true } } })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  expect(w.toasts).toEqual([])

  w.root = OTHER
  w.sessionId = 's2'
  await $.session.start({ cwd: OTHER, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  expect(w.toasts).toEqual([TOAST])
})

test('rules are set on the profile card: add a folder, switch subfolders, remove it', SLOW, async ($, on) => {
  const w = world(on, { store: saved(profile('video-work', 'Video work', ['alpha'], [])) })
  const ui = await openPanel($)
  await ui.press({ key: 'page:profiles' })

  const options = (await ui.find({ key: 'rule:video-work' }))?.props['options'] as { value: string; label: string }[]
  expect(options).toEqual([
    { value: '__none__', label: '+ Add a folder…' },
    { value: 'c:/proj', label: 'proj · this folder' },
    { value: 'c:/work/other', label: 'other' },
  ])

  await ui.select({ key: 'rule:video-work', value: 'c:/work/other' })
  expect(await ui.find({ type: 'Text', text: /^Suggest in other/ })).toBeDefined()
  // Subfolders are included unless switched off.
  expect(await shows(ui, 'rulesub:video-work|c:/work/other')).toBe('On')
  await ui.press({ key: 'rulesub:video-work|c:/work/other' })
  expect(await shows(ui, 'rulesub:video-work|c:/work/other')).toBe('Off')
  // A folder with a rule is no longer offered for a second one.
  const left = (await ui.find({ key: 'rule:video-work' }))?.props['options'] as { value: string }[]
  expect(left.map(option => option.value)).toEqual(['__none__', 'c:/proj'])

  await ui.press({ key: 'unrule:video-work|c:/work/other' })
  expect(await ui.find({ key: 'rulesub:video-work|c:/work/other' })).toBeUndefined()

  // A rule for this folder: suggested on the Skills page at once, and still nothing applied.
  await ui.select({ key: 'rule:video-work', value: 'c:/proj' })
  await ui.press({ key: 'page:skills' })
  expect(await ui.find({ key: 'suggest:apply' })).toBeDefined()
  expect(w.files[LOCAL]).toBeUndefined()
  expect(w.toasts).toEqual([])
  await ui.unmount()
})

test('deleting a profile takes its suggestion away', SLOW, async ($, on) => {
  world(on, { store: saved(VIDEO) })
  const ui = await openPanel($)
  expect(await ui.find({ key: 'suggest:apply' })).toBeDefined()
  await ui.press({ key: 'page:profiles' })
  await ui.press({ key: 'delete:video-work' })
  await ui.press({ key: 'delete:video-work' })
  await ui.press({ key: 'page:skills' })
  expect(await ui.find({ key: 'suggest:apply' })).toBeUndefined()
  await ui.unmount()
})
