// The Profiles page: save the setup the Skills page shows, and use it again
// in any folder or chat.
import type { RenderElement } from 'claude-code'

import type { Notice, Profile, ProfileAct, Profiles } from '../types'
import { baseName, folderKey } from './lib'
import { profileSummary } from './profiles'
import { NONE, caption, heading, lastChangeRow, noticeLine, toggle } from './ui'
import type { Act, Kit } from './ui'

export type ProfilesData = {
  profiles: Profiles
  act: ProfileAct
  /** The words of the open Apply preview, and whether it would change nothing. */
  preview: { text: string; isSame: boolean } | null
  /** Where Save and Apply land: a folder's name, or "this chat". */
  where: string
  isSession: boolean
  isOther: boolean
  /** What Save would keep right now: "23 off · 2 name only". */
  now: string
  said: Notice
  lastChange: string | null
  /** The folders a rule can name, most recent first. */
  folders: { key: string; label: string }[]
}

export function profilesPage(kit: Kit, d: ProfilesData, act: Act): RenderElement {
  const { Box, Button, Input, Select, Text } = kit
  const stepOf = (id: string) => (d.act !== null && d.act.id === id ? d.act.kind : null)

  const rules = (profile: Profile) => {
    const taken = new Set(profile.folders.map(rule => folderKey(rule.path)))
    const free = d.folders.filter(folder => !taken.has(folder.key))

    return (
      <Box flexDirection="column" gap="xs">
        {profile.folders.map(rule => {
          const key = folderKey(rule.path)

          return (
            <Box key={`rule-row:${profile.id}|${key}`} flexDirection="row" alignItems="center" flexWrap="wrap" gap={1}>
              <Text size="caption" wrap="truncate-end">
                {`Suggest in ${baseName(rule.path)}`}
                <Text dimColor>{' · with subfolders'}</Text>
              </Text>
              {toggle(kit, `rulesub:${profile.id}|${key}`, rule.withSubfolders ? 'on' : 'off', () =>
                act.toggleRule(profile.id, key),
              )}
              <Button key={`unrule:${profile.id}|${key}`} plain dimColor label="×" onPress={() => act.removeRule(profile.id, key)} />
            </Box>
          )
        })}
        {free.length > 0 && (
          <Select
            key={`rule:${profile.id}`}
            label="Suggest in folders"
            value={NONE}
            options={[{ value: NONE, label: '+ Add a folder…' }, ...free.map(folder => ({ value: folder.key, label: folder.label }))]}
            onSelect={value => {
              if (value !== NONE) act.addRule(profile.id, value)
            }}
          />
        )}
      </Box>
    )
  }

  const card = (profile: Profile) => {
    const step = stepOf(profile.id)

    return (
      <Box key={`profile:${profile.id}`} flexDirection="column" gap="xs" borderStyle="round" borderColor="inactive" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Text weight="semibold" wrap="truncate-end">
            {profile.name}
          </Text>
          {caption(kit, profileSummary(profile))}
        </Box>
        {step === 'apply' && d.preview !== null ? (
          <Box flexDirection="column" gap="xs">
            <Text wrap="wrap">{d.preview.text}</Text>
            <Box flexDirection="row" gap={1}>
              {!d.preview.isSame && (
                <Button key={`confirm:${profile.id}`} variant="primary" label="Apply" onPress={() => act.applyProfile(profile.id)} />
              )}
              <Button key={`cancel:${profile.id}`} label={d.preview.isSame ? 'OK' : 'Cancel'} onPress={() => act.profileCancel()} />
            </Box>
          </Box>
        ) : step === 'rename' ? (
          <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={16}>
              <Input
                key={`rename:${profile.id}`}
                placeholder="New name"
                submitLabel="rename"
                value={profile.name}
                autoFocus
                onSubmit={text => act.renameProfile(profile.id, text)}
              />
            </Box>
            <Button key={`cancel:${profile.id}`} label="Cancel" onPress={() => act.profileCancel()} />
          </Box>
        ) : (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Button key={`apply:${profile.id}`} variant="primary" label="Apply here" onPress={() => act.profileStep(profile.id, 'apply')} />
            <Button
              key={`update:${profile.id}`}
              label={step === 'update' ? 'Sure? Update' : 'Update'}
              onPress={() => act.profileStep(profile.id, 'update')}
            />
            <Button key={`renaming:${profile.id}`} label="Rename" onPress={() => act.profileStep(profile.id, 'rename')} />
            <Button
              key={`delete:${profile.id}`}
              label={step === 'delete' ? 'Sure? Delete' : 'Delete'}
              onPress={() => act.profileStep(profile.id, 'delete')}
            />
          </Box>
        )}
        {rules(profile)}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {heading(kit, 'Profiles')}
      {!d.isOther && (
        <Box flexDirection="row" gap={1}>
          <Button
            key="scope:project"
            variant={d.isSession ? 'secondary' : 'primary'}
            label="This project"
            onPress={() => act.scope('project')}
          />
          <Button
            key="scope:session"
            variant={d.isSession ? 'primary' : 'secondary'}
            label="This session"
            onPress={() => act.scope('session')}
          />
        </Box>
      )}
      <Input
        key="profile:new"
        label="Save this setup as"
        placeholder="Name, e.g. Video work"
        submitLabel="save"
        value=""
        onSubmit={text => act.saveProfile(text)}
      />
      {caption(
        kit,
        `A profile keeps what is set now for ${d.where}${d.isOther ? ' (another folder)' : ''}: ${d.now}. Apply it anywhere later.`,
      )}
      {noticeLine(kit, d.said)}
      {lastChangeRow(kit, d.lastChange, act)}
      {d.profiles.items.length === 0 ? <Text dimColor>No profiles yet. Type a name above to save your first.</Text> : d.profiles.items.map(card)}
      {d.profiles.deleted.length > 0 && (
        <Box flexDirection="column" gap="xs">
          {caption(kit, 'Recently deleted')}
          {d.profiles.deleted.map(profile => (
            <Box key={`deleted:${profile.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
              <Text dimColor wrap="truncate-end">{`${profile.name} · ${profileSummary(profile)}`}</Text>
              <Button key={`restore:${profile.id}`} label="Restore" onPress={() => act.restoreProfile(profile.id)} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
