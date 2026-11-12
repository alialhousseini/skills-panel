// The Projects page: every folder Claude was used in, from one place.
import type { RenderElement } from 'claude-code'

import type { CopyAsk, FolderCard, Notice } from '../types'
import { COLORS, barSvg } from './charts'
import { FOLDERS_FIRST } from './folders'
import { ago, count } from './lib'
import { NONE, caption, cellsBar, heading, noticeLine } from './ui'
import type { Act, Kit } from './ui'

export type ProjectsData = {
  cards: FolderCard[]
  /** When the cards were read, for "3 days ago". */
  now: number
  isLoaded: boolean
  /** How many skills there are, for each card's bar. */
  skills: number
  copy: CopyAsk
  showHidden: boolean
  allFolders: boolean
  said: Notice
  /** Usage is being counted (the trackUsage option). */
  isTracking: boolean
  confirmClear: boolean
}

function stats(card: FolderCard, now: number): string {
  if (card.error !== null) return `${card.error}.`
  const changed = card.lastChange === null ? '' : ` · last change ${ago(now - card.lastChange)}`

  return `${card.off} off · ${card.nameOnly} name only${changed}`
}

export function projectsPage(kit: Kit, d: ProjectsData, act: Act): RenderElement {
  const { Box, Button, Select, Text, picture } = kit
  const hidden = d.cards.filter(card => card.isHidden)
  const listed = d.cards.filter(card => d.showHidden || !card.isHidden)
  const shown = d.allFolders ? listed : listed.slice(0, FOLDERS_FIRST)
  const nameOf = (key: string) => d.cards.find(card => card.key === key)?.name ?? key

  const card = (one: FolderCard) => {
    const onCount = Math.max(0, d.skills - one.off)
    const others = d.cards.filter(other => other.key !== one.key && !other.isHidden && other.error === null)
    const copy = d.copy !== null && d.copy.from === one.key ? d.copy : null

    return (
      <Box key={`folder:${one.key}`} flexDirection="column" gap="xs" borderStyle="round" borderColor="inactive" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Box flexDirection="column" flexShrink={1}>
            <Text weight="semibold" wrap="truncate-end">
              {one.name}
              {one.isHere && <Text dimColor>{' · this folder'}</Text>}
              {one.isHidden && <Text dimColor>{' · hidden'}</Text>}
            </Text>
            {one.parent !== '' && (
              <Text size="caption" dimColor wrap="truncate-start">
                {one.parent}
              </Text>
            )}
          </Box>
          <Box flexDirection="row" gap={1}>
            <Button key={`manage:${one.key}`} variant="primary" label="Manage" onPress={() => act.manage(one.key)} />
            <Button key={`hide:${one.key}`} label={one.isHidden ? 'Unhide' : 'Hide'} onPress={() => act.toggleHide(one.key)} />
          </Box>
        </Box>
        <Box flexDirection="row" alignItems="center" gap={1}>
          {d.skills > 0 &&
            one.error === null &&
            picture(
              barSvg([{ value: onCount, color: COLORS.on }], 48, 6, d.skills),
              `${onCount} of ${d.skills} on`,
              cellsBar(kit, [{ value: onCount, color: COLORS.on }], 6, d.skills),
            )}
          {caption(kit, stats(one, d.now), one.error === null ? undefined : 'warning')}
        </Box>
        {copy !== null ? (
          <Box flexDirection="column" gap="xs">
            <Text wrap="wrap">
              {copy.count === 0
                ? `${nameOf(copy.to)} already has the same setup.`
                : `Changes ${count(copy.count, 'skill')} in ${nameOf(copy.to)}.`}
            </Text>
            <Box flexDirection="row" gap={1}>
              {copy.count > 0 && <Button key={`copy-yes:${one.key}`} variant="primary" label="Copy" onPress={() => act.copyGo()} />}
              <Button key={`copy-no:${one.key}`} label={copy.count === 0 ? 'OK' : 'Cancel'} onPress={() => act.copyCancel()} />
            </Box>
          </Box>
        ) : (
          others.length > 0 &&
          one.error === null && (
            <Select
              key={`copy:${one.key}`}
              label="Copy setup to"
              value={NONE}
              options={[{ value: NONE, label: 'pick a folder…' }, ...others.map(other => ({ value: other.key, label: other.name }))]}
              onSelect={value => {
                if (value !== NONE) act.copyAsk(one.key, value)
              }}
            />
          )
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
        {heading(kit, 'Projects')}
        <Button key="refresh" plain dimColor label="Refresh" onPress={() => act.refresh()} />
      </Box>
      {caption(kit, 'Every folder you used Claude in. Manage one from here, or copy its setup to another.')}
      {noticeLine(kit, d.said)}
      {!d.isLoaded ? (
        <Text dimColor>Reading your folders…</Text>
      ) : shown.length === 0 ? (
        <Text dimColor>No folders yet. They show up here once you use Claude in them.</Text>
      ) : (
        shown.map(card)
      )}
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {listed.length > FOLDERS_FIRST && (
          <Button
            key="folders:all"
            label={d.allFolders ? 'Show fewer' : `Show all ${listed.length}`}
            onPress={() => act.toggleAllFolders()}
          />
        )}
        {hidden.length > 0 && (
          <Button
            key="hidden"
            label={d.showHidden ? 'Hide hidden folders' : `Show hidden (${hidden.length})`}
            onPress={() => act.toggleShowHidden()}
          />
        )}
      </Box>
      {d.isTracking && (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          {caption(kit, 'How often skills are used is counted on this computer only.')}
          <Button
            key="usage:clear"
            label={d.confirmClear ? 'Sure? Clear' : 'Clear usage data'}
            onPress={() => act.clearUsage()}
          />
        </Box>
      )}
    </Box>
  )
}
