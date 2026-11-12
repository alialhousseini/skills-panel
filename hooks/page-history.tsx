// The History page: what changed, newest first, and an Undo for any of it.
import type { RenderElement } from 'claude-code'

import type { HistoryScope, HistoryView, Notice } from '../types'
import { caption, heading, noticeLine } from './ui'
import type { Act, Kit } from './ui'

export type HistoryData = {
  history: HistoryView
  said: Notice
  /** The folder "This folder" means: the one the Skills page shows. */
  folder: string
}

const SCOPES: readonly { value: HistoryScope; label: string }[] = [
  { value: 'folder', label: 'This folder' },
  { value: 'chat', label: 'This chat' },
  { value: 'all', label: 'Everywhere' },
]

const WHY_NOT: Record<'later' | 'away', string> = { later: 'changed later', away: 'another chat' }

export function historyPage(kit: Kit, d: HistoryData, act: Act): RenderElement {
  const { Box, Button, Select, Text } = kit
  const { rows, total, scope } = d.history

  return (
    <Box flexDirection="column" gap={1}>
      {heading(kit, 'History')}
      <Select
        key="history:scope"
        label="Show changes in"
        value={scope}
        options={SCOPES.map(one => ({ value: one.value, label: one.value === 'folder' ? `This folder (${d.folder})` : one.label }))}
        onSelect={value => act.historyScope(value === 'chat' ? 'chat' : value === 'all' ? 'all' : 'folder')}
      />
      {noticeLine(kit, d.said)}
      {rows.length === 0 ? (
        <Text dimColor>No changes here yet. Every switch you flip shows up here.</Text>
      ) : (
        rows.map(row => (
          <Box key={`change:${row.at}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Text wrap="truncate-end">
              <Text dimColor>{`${row.ago} · `}</Text>
              {row.what}
              <Text dimColor>{` · ${row.where}`}</Text>
            </Text>
            {row.state === 'undo' ? (
              <Button key={`undo:${row.at}`} label="Undo" onPress={() => act.undoAt(row.at)} />
            ) : (
              caption(kit, WHY_NOT[row.state])
            )}
          </Box>
        ))
      )}
      {caption(
        kit,
        `${total > rows.length ? `The newest ${rows.length} of ${total}. ` : ''}Undo puts back exactly what was there. "changed later": undo the newer change to that skill first.`,
      )}
    </Box>
  )
}
