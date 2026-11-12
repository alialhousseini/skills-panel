// The Skills page and the pure helpers: every test v0.2 had, kept passing.
import { expect, test } from 'claude-code/testing'

import { barSvg, donutSvg } from '../hooks/charts'
import {
  applyOps,
  autoTopic,
  denies,
  filterListing,
  invert,
  levelOp,
  noteFor,
  parseFrontmatter,
  shareCells,
} from '../hooks/lib'
import type { FileOp } from '../hooks/lib'
import { LISTING, LOCAL, PANE, ROOT, SLOW, local, shows, world } from './world'

test('the listing drops hidden skills, their extra lines included, and keeps the rest', () => {
  const out = filterListing(LISTING, name => name === 'claude-api' || name === 'cloudflare:wrangler')

  expect(out).toBe(
    ['The following skills are available for use with the Skill tool:', '', '- alpha: First skill.', '- gamma'].join(
      '\n',
    ),
  )
  expect(filterListing(LISTING, () => false)).toBe(LISTING)
})

test('a change and its undo give back exactly the settings that were there', () => {
  const start = { permissions: { allow: ['Bash(ls)'] }, skillOverrides: { keep: 'name-only' }, model: 'opus' }
  const { updated, applied } = applyOps(start, [
    { kind: 'override', id: 'alpha', before: null, after: 'off' },
    { kind: 'deny', id: 'cloudflare:wrangler', before: false, after: true },
    { kind: 'plugin', id: 'acme@acme', before: null, after: true },
  ])

  expect(updated).toEqual({
    permissions: { allow: ['Bash(ls)'], deny: ['Skill(cloudflare:wrangler)'] },
    skillOverrides: { keep: 'name-only', alpha: 'off' },
    model: 'opus',
    enabledPlugins: { 'acme@acme': true },
  })
  const back = [...applied].reverse().map(op => invert(op) as FileOp)
  expect(applyOps(updated, back).updated).toEqual(start)
})

test('deny rules match the forms Claude Code documents', () => {
  expect(denies('Skill(cloudflare:wrangler)', 'cloudflare:wrangler')).toBe(true)
  expect(denies('Skill(review-pr *)', 'review-pr')).toBe(true)
  expect(denies('Skill(anthropic-skills *)', 'anthropic-skills:pdf')).toBe(true)
  expect(denies('Skill(anthropic *)', 'anthropic-skills:pdf')).toBe(false)
  expect(denies('Skill(skill:deploy)', 'deploy')).toBe(true)
  expect(denies('Skill', 'anything')).toBe(true)
  expect(denies('Read(./.env)', 'anything')).toBe(false)
})

test('frontmatter: quoted, folded and plain values', () => {
  expect(parseFrontmatter("---\nname: beta\ndescription: 'Second: skill.'\ndisable-model-invocation: true\n---\n")).toEqual(
    { name: 'beta', description: 'Second: skill.', 'disable-model-invocation': 'true' },
  )
  expect(parseFrontmatter('---\ndescription: >\n  Project only\n  skill.\n---\n')['description']).toBe(
    'Project only skill.',
  )
  expect(parseFrontmatter('no frontmatter')).toEqual({})
})

test('the note lists what changed, with descriptions for what came back on', () => {
  const note = noteFor({
    'project:alpha': { scope: 'project', id: 'alpha', isOn: false, description: 'First skill.' },
    'session:gamma': { scope: 'session', id: 'gamma', isOn: true, description: 'Project only skill.' },
  })

  expect(note).toContain('Now OFF for this project:\n- alpha')
  expect(note).toContain('Now ON again for this session:\n- gamma: Project only skill.')
  expect(noteFor({})).toBe(null)
})

test('topics: names decide, a plugin stays together, an app skill goes by its own name', () => {
  expect(autoTopic({ id: 'video-director', kind: 'global', description: 'Direct short videos.' })).toBe('Video & motion')
  expect(autoTopic({ id: 'cloudflare:durable-objects', kind: 'plugin', description: 'Sound and video.' })).toBe(
    'Apps & code',
  )
  expect(autoTopic({ id: 'anthropic-skills:pdf', kind: 'app', description: '' })).toBe('Docs & office')
  expect(autoTopic({ id: 'productivity:start', kind: 'app', description: '' })).toBe('Notes & memory')
  // Words every description uses do not decide.
  expect(autoTopic({ id: 'alpha', kind: 'global', description: 'Use this skill when Claude needs it.' })).toBe('Other')
})

test('levels: the local file keeps only what differs from the settings below it', () => {
  const lower = [{ source: 'user' as const, settings: { skillOverrides: { beta: 'off', gamma: 'name-only' } } }]

  expect(levelOp({ id: 'alpha', kind: 'global' }, 'name-only', lower)).toEqual({
    kind: 'override',
    id: 'alpha',
    before: null,
    after: 'name-only',
  })
  expect(levelOp({ id: 'beta', kind: 'global' }, 'on', lower)).toMatchObject({ after: 'on' })
  expect(levelOp({ id: 'gamma', kind: 'global' }, 'name-only', lower)).toMatchObject({ after: null })
  expect(levelOp({ id: 'cloudflare:wrangler', kind: 'plugin' }, 'off', lower)).toEqual({
    kind: 'deny',
    id: 'cloudflare:wrangler',
    before: false,
    after: true,
  })
})

test('pictures: bars split by value, cells always add up', () => {
  expect(shareCells([3, 1, 0], 8)).toEqual([6, 2, 0])
  expect(shareCells([1, 1000], 10).reduce((a, b) => a + b, 0)).toBe(10)
  expect(shareCells([1, 1000], 10)[0]).toBe(1)
  const bar = barSvg(
    [
      { value: 3, color: '#111111' },
      { value: 1, color: '#222222' },
    ],
    200,
    8,
  )
  expect(bar.startsWith('<svg')).toBe(true)
  expect(bar).toContain('width="150"')
  expect(bar).toContain('fill="#222222"')
  expect(donutSvg([{ value: 1, color: '#333333' }], 60, 9)).toContain('stroke-dasharray')
})

test('the panel draws on every surface, with pictures where the surface has them', SLOW, async ($, on) => {
  world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'desktop') await ui.press({ key: 'load' })
    expect((await ui.find({ type: 'Text', text: /^Skills · proj$/ }))?.text).toBe('Skills · proj')
    expect(await ui.find({ key: 'scope:session' })).toBeDefined()
    expect(await ui.find({ key: 'show:off' })).toBeDefined()
    // Grouped by topic first: a plugin's skills and a Claude-app skill land by their names.
    expect(await ui.find({ key: 'open:topic:Apps & code' })).toBeDefined()
    expect(await ui.find({ key: 'open:topic:Docs & office' })).toBeDefined()
    expect(await shows(ui, 'all:topic:Other')).toBe('On')
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
    } else {
      expect((await ui.find({ type: 'Svg' }))?.props['alt']).toBe('5 of 5 skills on')
    }
    // By source: the whole-plugin switch shows.
    await ui.select({ key: 'groupBy', value: 'source' })
    expect(await shows(ui, 'plugin:acme@acme')).toBe('Off')
    await ui.select({ key: 'groupBy', value: 'topic' })
    await ui.unmount()
  }
})

test('This project: a switch writes settings.local.json, and Undo puts it back', SLOW, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })
  await ui.select({ key: 'groupBy', value: 'source' })

  // A global skill: skillOverrides.
  await ui.press({ key: 'open:global' })
  expect(await shows(ui, 'sw:alpha')).toBe('On')
  await ui.press({ key: 'sw:alpha' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off' } })
  expect(await shows(ui, 'sw:alpha')).toBe('Off')

  // A plugin skill: a deny rule, which the listing then leaves out.
  await ui.press({ key: 'open:plugin:cloudflare' })
  await ui.press({ key: 'sw:cloudflare:wrangler' })
  expect(local(w)).toEqual({
    skillOverrides: { alpha: 'off' },
    permissions: { deny: ['Skill(cloudflare:wrangler)'] },
  })
  const listing = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
  expect(listing.text).not.toContain('wrangler')
  expect(listing.text).toContain('- gamma')

  // Claude hears of both with the next prompt, once.
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[0]?.context.join('\n')).toContain('Now OFF for this project:\n- alpha\n- cloudflare:wrangler')
  expect(w.submitted[1]?.context).toEqual([])

  // Undo, twice: the file holds what it held before (nothing), and is not deleted.
  await ui.press({ key: 'undo' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off' } })
  await ui.press({ key: 'undo' })
  expect(local(w)).toEqual({})
  expect(w.files[LOCAL]).toBeDefined()
  await ui.unmount()
})

test('This project: other keys in settings.local.json are kept as they were', SLOW, async ($, on) => {
  const w = world(on)
  w.files[LOCAL] = JSON.stringify({ permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)'] }, model: 'opus' })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })
  await ui.press({ key: 'open:topic:Apps & code' })
  await ui.press({ key: 'sw:cloudflare:wrangler' })
  expect(local(w)).toEqual({
    permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)', 'Skill(cloudflare:wrangler)'] },
    model: 'opus',
  })
  await ui.press({ key: 'sw:cloudflare:wrangler' })
  expect(local(w)).toEqual({ permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)'] }, model: 'opus' })
  await ui.unmount()
})

test('This project: a broken settings.local.json is never overwritten', SLOW, async ($, on) => {
  const w = world(on)
  w.files[LOCAL] = '{ not json'
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:alpha' })
  expect(w.files[LOCAL]).toBe('{ not json')
  expect((await ui.find({ type: 'Text', text: /Nothing changed/ }))?.text).toContain('is not valid JSON')
  await ui.unmount()
})

test('This project: a whole plugin goes on with enabledPlugins', SLOW, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })
  await ui.select({ key: 'groupBy', value: 'source' })
  expect(await shows(ui, 'plugin:acme@acme')).toBe('Off')
  await ui.press({ key: 'plugin:acme@acme' })
  expect(local(w)).toEqual({ enabledPlugins: { 'acme@acme': true } })
  expect(await shows(ui, 'plugin:acme@acme')).toBe('On')
  await ui.press({ key: 'undo' })
  expect(local(w)).toEqual({})
  await ui.unmount()
})

test('This project: a topic switch turns its whole list off in one change, and Undo brings it back', SLOW, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })

  await ui.press({ key: 'all:topic:Other' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off', beta: 'off', gamma: 'off' } })
  expect(await shows(ui, 'all:topic:Other')).toBe('Off')

  // One back on: the group shows it is mixed, and pressing it turns all on.
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:beta' })
  expect(await shows(ui, 'all:topic:Other')).toBe('Some on')
  await ui.press({ key: 'all:topic:Other' })
  expect(local(w)).toEqual({})

  await ui.press({ key: 'undo' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off', gamma: 'off' } })
  await ui.unmount()
})

test('Details: a skill moves to another topic, or a new one, for every project', SLOW, async ($, on) => {
  // A topic picked in an earlier session comes back from the store.
  world(on, { store: { topics: { beta: 'Writing & social' } } })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })
  expect(await ui.find({ key: 'open:topic:Writing & social' })).toBeDefined()

  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'info:alpha' })
  await ui.select({ key: 'topic:alpha', value: 'Video & motion' })
  expect(await ui.find({ key: 'open:topic:Video & motion' })).toBeDefined()

  await ui.input({ key: 'newtopic:alpha', text: '  Client   work ' })
  expect(await ui.find({ key: 'open:topic:Client work' })).toBeDefined()
  expect(await ui.find({ key: 'open:topic:Video & motion' })).toBeUndefined()

  await ui.select({ key: 'topic:alpha', value: '__auto__' })
  expect(await ui.find({ key: 'open:topic:Client work' })).toBeUndefined()
  expect(await ui.find({ key: 'open:topic:Writing & social' })).toBeDefined()
  await ui.unmount()
})

test('Details: levels for this project, and Claude hears only what changes for it', SLOW, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'info:alpha' })

  // Name only: Claude may still call it, so nothing to tell.
  await ui.select({ key: 'level:alpha', value: 'name-only' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'name-only' } })
  expect(await shows(ui, 'sw:alpha')).toBe('On')
  await $.prompt.submit({ text: 'one', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[0]?.context).toEqual([])

  // Only by /name: Claude must leave it to the user.
  await ui.select({ key: 'level:alpha', value: 'user-invocable-only' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'user-invocable-only' } })
  await $.prompt.submit({ text: 'two', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[1]?.context.join('\n')).toContain('Now only for the user to run by typing /name')

  // On: the key goes, since on is the default.
  await ui.select({ key: 'level:alpha', value: 'on' })
  expect(local(w)).toEqual({})
  await $.prompt.submit({ text: 'three', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[2]?.context.join('\n')).toContain('Now ON again for this project:\n- alpha: First skill.')

  await ui.press({ key: 'undo' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'user-invocable-only' } })
  await ui.unmount()
})

test('Show: Off and Changed list only those, and Back to default resets them in one change', SLOW, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })

  await ui.press({ key: 'show:off' })
  expect(await ui.find({ type: 'Text', text: 'Nothing matches.' })).toBeDefined()
  await ui.press({ key: 'clear' })

  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:alpha' })
  await ui.press({ key: 'sw:gamma' })
  await ui.press({ key: 'show:off' })
  expect(await shows(ui, 'show:off')).toBe('Off 2')
  expect(await ui.find({ key: 'sw:alpha' })).toBeDefined()
  expect(await ui.find({ key: 'sw:beta' })).toBeUndefined()

  await ui.press({ key: 'show:changed' })
  await ui.press({ key: 'reset' })
  expect(local(w)).toEqual({})
  await ui.press({ key: 'undo' })
  expect(local(w)).toEqual({ skillOverrides: { alpha: 'off', gamma: 'off' } })
  await ui.unmount()
})

test('This session: the skill is refused and hidden, with no file written', SLOW, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })
  await ui.press({ key: 'scope:session' })
  await ui.press({ key: 'open:topic:Other' })
  await ui.press({ key: 'sw:gamma' })
  expect(w.files[LOCAL]).toBeUndefined()

  const refused = await $.tool.call({ tool: 'Skill', skill: 'gamma' })
  expect(refused.deny).toContain('switched off for this session')
  const allowed = await $.tool.call({ tool: 'Skill', skill: 'alpha' })
  expect(allowed.deny).toBeUndefined()

  const listing = await $.prompt.attachment({ type: 'skill_listing', text: LISTING, origin: { kind: 'engine' } })
  expect(listing.text).not.toContain('gamma')
  expect(listing.text).toContain('- alpha')

  // Back on, and Claude is told once.
  await ui.press({ key: 'sw:gamma' })
  const again = await $.tool.call({ tool: 'Skill', skill: 'gamma' })
  expect(again.deny).toBeUndefined()
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[0]?.context.join('\n')).toContain('Now ON again for this session:\n- gamma')
  await ui.unmount()
})

test('the first load shows the panel once', SLOW, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  await w.clock.settle()
  expect(w.opened).toEqual(['skills-panel'])

  // A later session start does not open it again.
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  await w.clock.settle()
  expect(w.opened).toEqual(['skills-panel'])
})

test("Claude's open_panel tool opens the panel and reports what is on and off", SLOW, async ($, on) => {
  const w = world(on)
  w.files[LOCAL] = JSON.stringify({ skillOverrides: { alpha: 'off' } })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const answer = await $.tool.call({ tool: 'mcp__skills-panel__open_panel' })
  const text = String(answer.result)

  expect(w.opened).toContain('skills-panel')
  expect(text).toContain('Project: proj')
  expect(text).toContain('Off for this project: 1.')
  expect(text).toContain('Your skills (all projects): 1/2 on')
  expect(text).toContain('Plugins off here: acme@acme')
})

test('the first-time panel is not used up where nothing could draw it', SLOW, async ($, on) => {
  const w = world(on, { placed: false })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  await w.clock.settle()
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await w.clock.advance(1_000)
  await w.clock.settle()
  expect(w.opened).toEqual(['skills-panel', 'skills-panel'])
})

test('a view an earlier version stored is declined, so the new panel starts from its defaults', SLOW, async ($, on) => {
  world(on)
  // What version 0.1 kept for the view: no Show filter, no grouping.
  on('state.get', { plugin: 'skills-panel', key: 'view' }, () => ({
    value: { scope: 'project', filter: '', open: ['project'] } as never,
    version: 3,
  }))
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })
  expect(await ui.find({ key: 'open:topic:Other' })).toBeDefined()
  expect((await ui.find({ key: 'show:all' }))?.props['variant']).toBe('primary')
  await ui.unmount()
})

test('a setup as large as a real one (170 skills, 15 more folders) draws, switches and filters quickly', SLOW, async ($, on) => {
  const w = world(on, { many: 165, folders: 15 })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'load' })
  expect((await ui.find({ type: 'Svg' }))?.props['alt']).toBe('170 of 170 skills on')

  const started = Date.now()
  await ui.press({ key: 'open:topic:Video & motion' })
  await ui.press({ key: 'all:topic:Video & motion' })
  await ui.input({ key: 'filter', text: 'helper-1', kind: 'change' })
  await ui.press({ key: 'show:off' })
  expect(Date.now() - started).toBeLessThan(5_000)

  const overrides = local(w)['skillOverrides'] as Record<string, string>
  expect(Object.keys(overrides).length).toBeGreaterThan(15)
  expect(await ui.find({ key: 'sw:video-helper-18' })).toBeDefined()
  expect(await ui.find({ key: 'sw:research-helper-1' })).toBeUndefined()

  // The other pages, with 17 folders and the changes just made.
  const later = Date.now()
  await ui.press({ key: 'page:projects' })
  const cards = (await ui.findAll({ type: 'Button' })).filter(button => (button.key ?? '').startsWith('manage:'))
  expect(cards).toHaveLength(8)
  expect(await shows(ui, 'folders:all')).toBe('Show all 17')
  await ui.press({ key: 'folders:all' })
  expect((await ui.findAll({ type: 'Button' })).filter(button => (button.key ?? '').startsWith('manage:'))).toHaveLength(17)
  expect(await ui.find({ type: 'Text', text: /^1 off · 0 name only$/ })).toBeDefined()
  await ui.press({ key: 'manage:c:/work/p3' })
  expect(await ui.find({ type: 'Text', text: /^Skills · p3 \(another folder\)$/ })).toBeDefined()
  await ui.press({ key: 'page:profiles' })
  await ui.input({ key: 'profile:new', text: 'Big' })
  await ui.press({ key: 'page:history' })
  await ui.press({ key: 'page:skills' })
  await ui.press({ key: 'target:back' })
  await ui.select({ key: 'focus', value: 'topic:Research & papers' })
  expect(Date.now() - later).toBeLessThan(5_000)
  await ui.unmount()
})
