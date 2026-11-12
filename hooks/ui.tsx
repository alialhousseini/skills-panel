// What every page draws with: the surface's elements, the handlers a press
// runs, and the small pieces the pages share. No `$` here: the pane's render
// hook builds a Kit and an Act and hands them in.
import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  RenderElement,
  SelectProps,
  TextProps,
} from 'claude-code'

import type { GroupBy, HistoryScope, Level, Notice, Page, ProfileAct, Scope, Show, SkillRow } from '../types'
import { COLORS } from './charts'
import type { Part } from './charts'
import { shareCells } from './lib'

export const KNOB = '●'
/** A Select's "nothing picked" value. */
export const NONE = '__none__'

/** The elements every surface has, and a picture that falls back on the terminal. */
export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input: ElementConstructor<InputProps>
  Select: ElementConstructor<SelectProps>
  /** An SVG where the surface draws one; the fallback where it does not (the terminal). */
  picture: (source: string, alt: string, fallback: RenderElement) => RenderElement
  isTerminal: boolean
  /** How many cells wide a bar may be on the terminal. */
  cells: number
}

/** Everything a press, a pick or a typed line can do. Each runs in the plugin and returns at once. */
export type Act = {
  page: (page: Page) => void
  refresh: () => void
  undo: () => void

  // Skills page
  scope: (scope: Scope) => void
  show: (show: Show) => void
  filter: (text: string) => void
  groupBy: (groupBy: GroupBy) => void
  toggleGroup: (key: string) => void
  toggleDetail: (id: string) => void
  clearFilters: () => void
  switchOne: (id: string) => void
  switchGroup: (key: string) => void
  switchPlugin: (id: string) => void
  setLevel: (id: string, level: Level) => void
  setTopic: (row: SkillRow, topic: string | null) => void
  reset: () => void
  backHere: () => void
  setFocus: (value: string) => void
  suggestApply: () => void
  suggestLater: () => void
  suggestNever: () => void

  // Profiles page
  saveProfile: (name: string) => void
  /** Opens a card's step, or carries it out when it is the "Sure?" press. */
  profileStep: (id: string, kind: NonNullable<ProfileAct>['kind']) => void
  profileCancel: () => void
  applyProfile: (id: string) => void
  renameProfile: (id: string, name: string) => void
  restoreProfile: (id: string) => void
  addRule: (id: string, folder: string) => void
  removeRule: (id: string, folder: string) => void
  toggleRule: (id: string, folder: string) => void

  // Projects page
  manage: (folder: string) => void
  toggleHide: (folder: string) => void
  toggleShowHidden: () => void
  toggleAllFolders: () => void
  copyAsk: (from: string, to: string) => void
  copyGo: () => void
  copyCancel: () => void
  clearUsage: () => void

  // History page
  historyScope: (scope: HistoryScope) => void
  undoAt: (at: number) => void
}

export const PAGES: readonly { page: Page; label: string }[] = [
  { page: 'skills', label: 'Skills' },
  { page: 'profiles', label: 'Profiles' },
  { page: 'projects', label: 'Projects' },
  { page: 'history', label: 'History' },
]

/** The four tabs at the top of the pane. */
export function tabs(kit: Kit, current: Page, act: Act): RenderElement {
  const { Box, Button } = kit

  return (
    <Box flexDirection="row" flexWrap="wrap" gap={1}>
      {PAGES.map(({ page, label }) => (
        <Button
          key={`page:${page}`}
          variant={page === current ? 'primary' : 'secondary'}
          label={label}
          onPress={() => act.page(page)}
        />
      ))}
    </Box>
  )
}

/** A small dim line, or a coloured one. */
export function caption(kit: Kit, text: string, color?: string): RenderElement {
  const { Text } = kit

  return color === undefined ? (
    <Text size="caption" dimColor wrap="wrap">
      {text}
    </Text>
  ) : (
    <Text size="caption" color={color} wrap="wrap">
      {text}
    </Text>
  )
}

/** A slide switch: the knob sits right when on, left when off, in the middle for some. */
export function toggle(kit: Kit, key: string, state: 'on' | 'off' | 'some', onPress: () => void): RenderElement {
  const { Button, Text } = kit
  if (state === 'on') {
    return (
      <Button key={key} variant="primary" label="On" onPress={onPress}>
        {'On  '}
        <Text>{KNOB}</Text>
      </Button>
    )
  }
  if (state === 'off') {
    return (
      <Button key={key} variant="secondary" label="Off" onPress={onPress}>
        <Text dimColor>{KNOB}</Text>
        {'  Off'}
      </Button>
    )
  }

  return (
    <Button key={key} variant="secondary" label="Some on" onPress={onPress}>
      {'Some '}
      <Text color={COLORS.on}>{KNOB}</Text>
      {' '}
    </Button>
  )
}

/** A bar of cells for the terminal, split among the parts; `of` is the full scale. */
export function cellsBar(kit: Kit, parts: readonly Part[], width: number, of?: number): RenderElement {
  const { Text } = kit
  const sum = parts.reduce((total, part) => total + Math.max(0, part.value), 0)
  const counts = shareCells([...parts.map(part => part.value), Math.max(0, (of ?? sum) - sum)], width)

  return (
    <Text>
      {parts.map((part, i) => (
        <Text color={part.color}>{'█'.repeat(counts[i] ?? 0)}</Text>
      ))}
      <Text dimColor>{'░'.repeat(counts[parts.length] ?? 0)}</Text>
    </Text>
  )
}

/** What the last action said, in its colour. */
export function noticeLine(kit: Kit, said: Notice): RenderElement | null {
  const { Text } = kit
  if (said === null) return null

  return (
    <Text color={said.tone === 'error' ? 'error' : said.tone === 'warn' ? 'warning' : 'success'} wrap="wrap">
      {said.text}
    </Text>
  )
}

/** "Last change: … [Undo]", for the folder or the session the Skills page shows. */
export function lastChangeRow(kit: Kit, lastChange: string | null, act: Act): RenderElement | null {
  const { Box, Button, Text } = kit
  if (lastChange === null) return null

  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
      <Text dimColor wrap="truncate-end">{`Last change: ${lastChange}`}</Text>
      <Button key="undo" label="Undo" onPress={() => act.undo()} />
    </Box>
  )
}

/** A page's heading. */
export function heading(kit: Kit, text: string): RenderElement {
  const { Text } = kit

  return (
    <Text weight="bold" size="heading" wrap="truncate-end">
      {text}
    </Text>
  )
}
