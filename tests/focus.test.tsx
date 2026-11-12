// Focus this chat: for one chat, keep only one topic (or one profile).
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { LOCAL, SLOW, openPanel, world } from './world'

/**
 * Nine more skills, one per topic, and one skill built into Claude Code. By its
 * name `review` sorts under Apps & code, so only being built in keeps it on.
 */
const TOPICS = { many: 9, builtins: ['review'] }

async function isRefused($: Engine, skill: string): Promise<boolean> {
  return (await $.tool.call({ tool: 'Skill', skill })).deny !== undefined
}

test('a topic focus turns off exactly the skills outside it, for this chat only', SLOW, async ($, on) => {
  const w = world(on, TOPICS)
  const ui = await openPanel($)

  // The choices: nothing, each topic that has skills, each profile.
  const options = (await ui.find({ key: 'focus' }))?.props['options'] as { value: string; label: string }[]
  expect(options[0]).toEqual({ value: 'none', label: 'Nothing (all skills)' })
  expect(options.map(option => option.value)).toContain('topic:Video & motion')
  expect(options.map(option => option.value)).toContain('topic:Other')

  await ui.select({ key: 'focus', value: 'topic:Video & motion' })

  // Outside the topic: off. A call is refused, and the listing leaves it out.
  for (const skill of ['alpha', 'gamma', 'cloudflare:wrangler', 'anthropic-skills:pdf', 'research-helper-1', 'music-helper-5']) {
    expect(await isRefused($, skill), skill).toBe(true)
  }
  // Inside the topic, built into Claude Code, or in "Claude & setup": on.
  for (const skill of ['video-helper-0', 'review', 'skill-helper-8']) {
    expect(await isRefused($, skill), skill).toBe(false)
  }
  // Nothing is saved to the project.
  expect(w.files[LOCAL]).toBeUndefined()

  expect(w.status).toBe('Focus: Video & motion · 3 skills on (/skills-panel)')
  expect(await ui.find({ type: 'Text', text: /^Focused on Video & motion\. 3 skills on in this chat\.$/ })).toBeDefined()
  expect((await ui.find({ key: 'focus' }))?.props['value']).toBe('topic:Video & motion')

  // Claude is told once, with the next prompt.
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect(w.submitted[0]?.context.join('\n')).toContain('Now OFF for this session:\n- gamma\n- alpha')
  await ui.unmount()
})

test('End focus turns back on only what the focus turned off; switches flipped by hand stay', SLOW, async ($, on) => {
  const w = world(on, TOPICS)
  const ui = await openPanel($)
  await ui.press({ key: 'scope:session' })
  await ui.input({ key: 'filter', text: 'helper', kind: 'change' })

  // By hand, before the focus: one skill off.
  await ui.press({ key: 'sw:expo-helper-2' })
  await ui.select({ key: 'focus', value: 'topic:Video & motion' })
  // By hand, during the focus: one the focus turned off comes back, one inside the topic goes off,
  // and one the focus turned off is flipped twice.
  await ui.press({ key: 'sw:research-helper-1' })
  await ui.press({ key: 'sw:video-helper-0' })
  await ui.press({ key: 'sw:music-helper-5' })
  await ui.press({ key: 'sw:music-helper-5' })
  expect(await isRefused($, 'research-helper-1')).toBe(false)
  expect(await isRefused($, 'music-helper-5')).toBe(true)

  await ui.press({ key: 'focus:end' })
  expect(await ui.find({ key: 'focus:end' })).toBeUndefined()
  // The focus's own switches are undone.
  expect(await isRefused($, 'alpha')).toBe(false)
  expect(await isRefused($, 'logo-helper-6')).toBe(false)
  // The hand-made ones stay: off before, turned off inside the topic, turned off again by hand.
  expect(await isRefused($, 'expo-helper-2')).toBe(true)
  expect(await isRefused($, 'video-helper-0')).toBe(true)
  expect(await isRefused($, 'music-helper-5')).toBe(true)
  expect(await isRefused($, 'research-helper-1')).toBe(false)
  expect(w.status).toBe('Skills off here: 3 (/skills-panel)')
  expect((await ui.find({ type: 'Text', text: /^Last change: / }))?.text).toBe(
    'Last change: focus on "Video & motion" ended (this session)',
  )
  await ui.unmount()
})

test('a focus is one change: Undo takes it back whole, and Undo of End focus brings it back', SLOW, async ($, on) => {
  const w = world(on, TOPICS)
  const ui = await openPanel($)
  await ui.select({ key: 'focus', value: 'topic:Video & motion' })
  expect((await ui.find({ type: 'Text', text: /^Last change: / }))?.text).toBe(
    'Last change: focus on "Video & motion" (this session)',
  )

  await ui.press({ key: 'undo' })
  expect(await isRefused($, 'alpha')).toBe(false)
  expect(await ui.find({ key: 'focus:end' })).toBeUndefined()
  expect((await ui.find({ key: 'focus' }))?.props['value']).toBe('none')
  expect(w.status).toBeUndefined()

  // Focus, end it, then undo the ending: the focus is in force again.
  await ui.select({ key: 'focus', value: 'topic:Video & motion' })
  await ui.select({ key: 'focus', value: 'none' })
  expect(await isRefused($, 'alpha')).toBe(false)
  await ui.press({ key: 'undo' })
  expect(await isRefused($, 'alpha')).toBe(true)
  expect(await ui.find({ key: 'focus:end' })).toBeDefined()
  expect(w.status).toBe('Focus: Video & motion · 3 skills on (/skills-panel)')
  await ui.unmount()
})

test('moving the focus to another topic is one change too', SLOW, async ($, on) => {
  world(on, TOPICS)
  const ui = await openPanel($)
  await ui.select({ key: 'focus', value: 'topic:Video & motion' })
  await ui.select({ key: 'focus', value: 'topic:Audio & voice' })
  expect(await isRefused($, 'video-helper-0')).toBe(true)
  expect(await isRefused($, 'music-helper-5')).toBe(false)

  // One Undo: back to the first focus.
  await ui.press({ key: 'undo' })
  expect(await isRefused($, 'video-helper-0')).toBe(false)
  expect(await isRefused($, 'music-helper-5')).toBe(true)
  expect((await ui.find({ key: 'focus' }))?.props['value']).toBe('topic:Video & motion')
  await ui.unmount()
})

test('a focus on a profile uses its off list; its levels are left out', SLOW, async ($, on) => {
  const w = world(on, {
    ...TOPICS,
    store: {
      profiles: {
        version: 1,
        items: [
          {
            id: 'quiet',
            name: 'Quiet',
            off: ['alpha', 'gamma', 'review', 'ghost'],
            levels: { beta: 'name-only' },
            folders: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        deleted: [],
      },
    },
  })
  const ui = await openPanel($)
  const options = (await ui.find({ key: 'focus' }))?.props['options'] as { value: string; label: string }[]
  expect(options).toContainEqual({ value: 'profile:quiet', label: 'Profile: Quiet' })

  await ui.select({ key: 'focus', value: 'profile:quiet' })
  expect(await isRefused($, 'alpha')).toBe(true)
  expect(await isRefused($, 'gamma')).toBe(true)
  // A profile's list is the user's own choice: it may name a built-in skill.
  expect(await isRefused($, 'review')).toBe(true)
  expect(await isRefused($, 'beta')).toBe(false)
  expect(await isRefused($, 'video-helper-0')).toBe(false)
  expect(w.files[LOCAL]).toBeUndefined()
  expect(w.status).toBe('Focus: Quiet · 12 skills on (/skills-panel)')

  await ui.press({ key: 'focus:end' })
  expect(await isRefused($, 'alpha')).toBe(false)
  await ui.unmount()
})

test('a focus comes back after a reload of the panel in the same session', SLOW, async ($, on) => {
  const w = world(on, {
    ...TOPICS,
    // What this session saved before the reload: its switches and its focus.
    store: {
      'session-off:s1': { at: 900, ids: ['alpha', 'gamma'] },
      'focus:s1': { topic: 'Video & motion', label: 'Video & motion', added: ['alpha', 'gamma'], at: 900 },
    },
  })
  const ui = await openPanel($)
  expect(await ui.find({ key: 'focus:end' })).toBeDefined()
  expect(w.status).toContain('Focus: Video & motion')
  await ui.press({ key: 'focus:end' })
  expect(await isRefused($, 'alpha')).toBe(false)
  await ui.unmount()
})
