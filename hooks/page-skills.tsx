// The Skills page: the overview, the filters, and every skill with its switch.
import type { RenderElement } from 'claude-code'

import type { Focus, Notice, Show, SkillRow, UsageView } from '../types'
import { COLORS, barSvg, donutSvg } from './charts'
import type { Part } from './charts'
import {
  DAY_MS,
  LEVELS,
  LEVEL_LABELS,
  LEVEL_TAGS,
  OTHER_TOPIC,
  TOPIC_RULES,
  ago,
  autoTopic,
  clip,
  count,
  groupTitle,
  isCallable,
  isLevel,
  shortCount,
  shortName,
  sourceTag,
  topicRank,
  usesDeny,
} from './lib'
import type { Group, Model } from './model'
import { KNOB, caption, cellsBar, heading, lastChangeRow, noticeLine, toggle } from './ui'
import type { Act, Kit } from './ui'
import { usedChip, usedLine } from './usage'

const AUTO = '__auto__'

const SHOWS: readonly Show[] = ['all', 'on', 'off', 'changed', 'unused']
const SHOW_LABELS: Record<Show, string> = { all: 'All', on: 'On', off: 'Off', changed: 'Changed', unused: 'Unused' }

export type SkillsData = {
  m: Model
  isBusy: boolean
  said: Notice
  lastChange: string | null
  focus: Focus
  /** What the Focus select lists: nothing, each topic that has skills, each profile. */
  focusOptions: { value: string; label: string }[]
  focusValue: string
  /** A folder rule's suggestion; `preview` is set once Apply was pressed. */
  offer: { profileId: string; name: string; preview: string | null } | null
  used: UsageView
  /** How many skills are on but unused, when the hint line is due; null otherwise. */
  unusedHint: number | null
}

/** The one line under the Unused filter: what it lists, and since when uses are counted here. */
function unusedHelp(used: UsageView): string {
  const days = count(used.unusedDays, 'day')
  const what = `On here, but not used here in the last ${days}.`
  if (used.since === null) return `${what} Uses are counted from your next chat in this folder.`
  const began = ago(used.now - used.since)

  // A skill cannot be called unused for 30 days before 30 days have been counted.
  return used.now - used.since >= used.unusedDays * DAY_MS
    ? `${what} Counting began ${began}.`
    : `${what} Counting began ${began}, so skills show up here once ${days} have passed.`
}

export function skillsPage(kit: Kit, d: SkillsData, act: Act): RenderElement {
  const { Box, Button, Input, Select, Text, picture } = kit
  const { m, used } = d
  const { inv, pv, current, isSession, isOther } = m

  // ---- what Claude's skill list costs: each live skill's entry, estimated where it is not listed now
  const known = inv.skills.filter(row => row.tokens !== null)
  const average = known.length > 0 ? known.reduce((sum, row) => sum + (row.tokens ?? 0), 0) / known.length : 0
  const tokensOf = (row: SkillRow) =>
    !m.isLive(row) || row.isManual || !isCallable(m.levelNow(row)) ? 0 : (row.tokens ?? average)
  const liveRows = inv.skills.filter(m.isLive)
  const liveTokens = liveRows.reduce((sum, row) => sum + tokensOf(row), 0)
  const offHere = inv.skills.filter(row => m.projectOff.has(row.id)).length
  const offSession = inv.skills.filter(row => !m.projectOff.has(row.id) && m.offInSession.has(row.id)).length
  const stateParts: Part[] = [
    { value: liveRows.length, color: COLORS.on },
    { value: offSession, color: COLORS.session },
    { value: offHere, color: COLORS.off },
  ]
  const shares = m.groups
    .map(group => ({ title: group.title, color: group.color, value: group.rows.reduce((s, row) => s + tokensOf(row), 0) }))
    .filter(share => share.value > 0)
  const top = [...shares].sort((a, b) => b.value - a.value).slice(0, 3)
  const budget = inv.budget

  const overview = (
    <Box flexDirection="column" gap="xs" borderStyle="round" borderColor="inactive" paddingX={1}>
      <Box flexDirection="row" alignItems="center" gap={2}>
        {!kit.isTerminal &&
          picture(donutSvg(stateParts, 60, 9), `${liveRows.length} of ${inv.skills.length} skills on`, <Text />)}
        <Box flexDirection="column" flexShrink={1}>
          <Text>
            <Text size="title" weight="bold" tabular color={COLORS.on}>
              {String(liveRows.length)}
            </Text>
            <Text dimColor>
              {isOther
                ? ` of ${inv.skills.length} skills on in ${inv.project}`
                : ` of ${inv.skills.length} skills on in this session`}
            </Text>
          </Text>
          {isOther ? (
            <Text size="caption">
              <Text color={COLORS.off}>{KNOB}</Text>
              {` ${offHere} off for that folder`}
            </Text>
          ) : (
            <Text size="caption">
              <Text color={COLORS.off}>{KNOB}</Text>
              {` ${offHere} off for this project   `}
              <Text color={COLORS.session}>{KNOB}</Text>
              {` ${offSession} off for this session`}
            </Text>
          )}
        </Box>
      </Box>
      {kit.isTerminal && cellsBar(kit, stateParts, kit.cells)}
      <Text size="caption">
        <Text weight="semibold">{`Claude's skill list ≈ ${shortCount(liveTokens)} tokens`}</Text>
        <Text dimColor>{' · colours match the groups below'}</Text>
      </Text>
      {shares.length > 0 &&
        picture(barSvg(shares, 280, 8), `Skill list tokens by group`, cellsBar(kit, shares, kit.cells))}
      {top.length > 0 && (
        <Text size="caption" wrap="wrap">
          {top.map((share, i) => [
            i > 0 ? '   ' : '',
            <Text color={share.color}>{KNOB}</Text>,
            ` ${share.title} ${Math.round((share.value / Math.max(1, liveTokens)) * 100)}%`,
          ])}
        </Text>
      )}
      {budget !== null &&
        budget.included < budget.total &&
        caption(
          kit,
          `Only ${budget.included} of ${budget.total} skills fit in Claude's skill list. Switch off what this project doesn't need.`,
          'warning',
        )}
    </Box>
  )

  // ---- one skill's details: what it is, how Claude sees it, how much it is used, and its topic
  const allTopics = [...new Set([...TOPIC_RULES.map(rule => rule.name), ...Object.values(m.picked), OTHER_TOPIC])].sort(
    (a, b) => topicRank(a) - topicRank(b) || a.localeCompare(b),
  )
  const details = (row: SkillRow) => {
    const lock = m.lockOf(row)
    const auto = autoTopic(row)
    const levelControl = isSession ? (
      caption(kit, 'Finer levels are set per project: pick "This project" above.')
    ) : usesDeny(row) ? (
      caption(kit, 'Plugin and Claude-app skills are only on or off.')
    ) : lock !== null ? (
      caption(kit, `Locked: ${lock}.`)
    ) : (
      <Select
        key={`level:${row.id}`}
        label="How Claude sees it"
        value={m.levelNow(row)}
        options={LEVELS.map(level => ({ value: level, label: LEVEL_LABELS[level] }))}
        onSelect={value => {
          if (isLevel(value)) act.setLevel(row.id, value)
        }}
      />
    )

    return (
      <Box flexDirection="column" gap="xs" marginLeft={1} paddingX={1} borderStyle="round" borderColor="inactive">
        {row.description !== '' && (
          <Text size="caption" wrap="wrap">
            {row.description}
          </Text>
        )}
        {caption(
          kit,
          `${groupTitle(row.group)} · ${row.tokens === null ? "not in Claude's skill list right now" : `≈${shortCount(row.tokens)} tokens in Claude's skill list`}`,
        )}
        {used.isTracking && caption(kit, usedLine(m.usedOf(row), used.everywhere[row.id] ?? 0, used.now))}
        {levelControl}
        <Select
          key={`topic:${row.id}`}
          label="Topic (all projects)"
          value={m.picked[row.id] ?? AUTO}
          options={[
            { value: AUTO, label: `Automatic: ${auto}` },
            ...allTopics.map(topic => ({ value: topic, label: topic })),
          ]}
          onSelect={value => act.setTopic(row, value === AUTO ? null : value)}
        />
        <Input
          key={`newtopic:${row.id}`}
          placeholder="Or type a new topic for it…"
          submitLabel="add"
          value=""
          onSubmit={text => act.setTopic(row, text)}
        />
      </Box>
    )
  }

  // ---- one skill's row
  const drawRow = (row: SkillRow) => {
    const isRowOn = m.isOn(row)
    const lock = m.lockOf(row)
    const isOpen = current.detail === row.id
    const tags: { text: string; color?: string }[] = []
    if (current.groupBy === 'topic') tags.push({ text: sourceTag(row) })
    const levelTag = LEVEL_TAGS[m.levelNow(row)]
    if (levelTag !== null) tags.push({ text: levelTag, color: 'suggestion' })
    if (row.isManual) tags.push({ text: 'manual: /name only' })
    const tag = pv.tags[row.id]
    if (tag !== undefined) tags.push({ text: tag })
    if (row.note !== null) tags.push({ text: row.note })
    if (!isSession && m.offInSession.has(row.id)) tags.push({ text: 'off this session', color: COLORS.session })
    const use = m.usedOf(row)
    if (used.isTracking && use !== undefined) tags.push({ text: usedChip(use, used.now) })

    return (
      <Box key={`row:${row.id}`} flexDirection="column" paddingLeft={2}>
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
              <Button key={`info:${row.id}`} plain dimColor={!isRowOn} onPress={() => act.toggleDetail(row.id)}>
                {shortName(row)}
                <Text dimColor>{isOpen ? ' ▴' : ' ▾'}</Text>
              </Button>
              {tags.map(one => caption(kit, one.text, one.color))}
            </Box>
            {!isOpen && row.description !== '' && (
              <Text dimColor size="caption" wrap="truncate-end">
                {clip(row.description, 160)}
              </Text>
            )}
          </Box>
          {lock !== null
            ? caption(kit, lock)
            : toggle(kit, `sw:${row.id}`, isRowOn ? 'on' : 'off', () => act.switchOne(row.id))}
        </Box>
        {isOpen && details(row)}
      </Box>
    )
  }

  // ---- one group: its header with a count, a bar and a switch for all of it, then its rows
  const autoOpen = m.needle !== '' || current.show === 'off' || current.show === 'changed' || current.show === 'unused'
  const drawGroup = (group: Group) => {
    if ((m.needle !== '' || current.show !== 'all') && group.shown.length === 0) return null
    if (group.rows.length === 0 && group.plugin === undefined) return null
    const isOpen = autoOpen || current.open.includes(group.key)
    const onCount = group.rows.filter(m.isOn).length
    const switchable = group.shown.filter(row => m.lockOf(row) === null)
    const state =
      switchable.length === 0 ? null : switchable.every(m.isOn) ? 'on' : switchable.some(m.isOn) ? 'some' : 'off'
    const groupTokens = group.rows.reduce((sum, row) => sum + tokensOf(row), 0)
    const plugin = group.plugin

    return (
      <Box key={`group:${group.key}`} flexDirection="column" gap="xs">
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Box flexDirection="row" alignItems="center" gap={1} flexShrink={1}>
            <Button key={`open:${group.key}`} plain onPress={() => act.toggleGroup(group.key)}>
              {isOpen ? '▾ ' : '▸ '}
              <Text color={group.color}>{KNOB}</Text>
              {` ${group.title}  `}
              <Text dimColor>{`${onCount}/${group.rows.length}`}</Text>
            </Button>
            {group.rows.length > 0 &&
              picture(
                barSvg([{ value: onCount, color: COLORS.on }], 48, 6, group.rows.length),
                `${onCount} of ${group.rows.length} on`,
                cellsBar(kit, [{ value: onCount, color: COLORS.on }], 6, group.rows.length),
              )}
            {groupTokens > 0 && caption(kit, `≈${shortCount(groupTokens)} tokens`)}
          </Box>
          {state !== null && toggle(kit, `all:${group.key}`, state, () => act.switchGroup(group.key))}
        </Box>
        {plugin !== undefined && (
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} paddingLeft={2}>
            {caption(
              kit,
              plugin.isOn
                ? 'Whole plugin: on here (loads in new sessions)'
                : 'Whole plugin: off here (its skills are not loaded)',
            )}
            {plugin.lockedBy !== null
              ? caption(kit, `set by ${plugin.lockedBy}`)
              : isSession
                ? caption(kit, 'project only')
                : toggle(kit, `plugin:${plugin.id}`, plugin.isOn ? 'on' : 'off', () => act.switchPlugin(plugin.id))}
          </Box>
        )}
        {isOpen && group.shown.map(drawRow)}
      </Box>
    )
  }

  const groups = m.groups.map(drawGroup).filter(group => group !== null)
  const scopeHelp = isSession
    ? 'Only this session. It resets when the session ends.'
    : `Saved for ${inv.project}. Every session here uses it.`

  // ---- the banners: a focus in force, a folder rule's suggestion, skills nobody uses here
  const focusBanner = d.focus !== null && !isOther && (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
      <Text color="suggestion" wrap="wrap">{`Focused on ${d.focus.label}. ${count(liveRows.length, 'skill')} on in this chat.`}</Text>
      <Button key="focus:end" label="End focus" onPress={() => act.setFocus('none')} />
    </Box>
  )
  const offer = isOther ? null : d.offer
  const offerBanner =
    offer !== null &&
    (offer.preview === null ? (
      <Box flexDirection="column" gap="xs" borderStyle="round" borderColor="suggestion" paddingX={1}>
        <Text wrap="wrap">
          {'Suggested for this folder: '}
          <Text weight="semibold">{offer.name}</Text>
        </Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="suggest:apply" variant="primary" label="Apply" onPress={() => act.suggestApply()} />
          <Button key="suggest:later" label="Not now" onPress={() => act.suggestLater()} />
          <Button key="suggest:never" label="Never here" onPress={() => act.suggestNever()} />
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column" gap="xs" borderStyle="round" borderColor="suggestion" paddingX={1}>
        <Text wrap="wrap">{`${offer.name}: ${offer.preview}`}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button
            key={`confirm:${offer.profileId}`}
            variant="primary"
            label="Apply"
            onPress={() => act.applyProfile(offer.profileId)}
          />
          <Button key={`cancel:${offer.profileId}`} label="Cancel" onPress={() => act.profileCancel()} />
        </Box>
      </Box>
    ))
  const unusedBanner = d.unusedHint !== null && current.show !== 'unused' && (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
      <Text dimColor wrap="wrap">
        {`${count(d.unusedHint, 'skill')} ${d.unusedHint === 1 ? 'is' : 'are'} on but unused here for ${count(used.unusedDays, 'day')}.`}
      </Text>
      <Button key="unused:show" label="Show them" onPress={() => act.show('unused')} />
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
        {heading(kit, `Skills · ${inv.project}${isOther ? ' (another folder)' : ''}`)}
        <Button key="refresh" plain dimColor label={d.isBusy ? 'Reading…' : 'Refresh'} onPress={() => act.refresh()} />
      </Box>
      {isOther ? (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" gap={1}>
            <Button key="target:back" variant="primary" label="Back to this folder" onPress={() => act.backHere()} />
          </Box>
          {caption(kit, `Switches here change ${inv.project}, not the folder this chat runs in.`)}
        </Box>
      ) : (
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" gap={1}>
            <Button
              key="scope:project"
              variant={isSession ? 'secondary' : 'primary'}
              label="This project"
              onPress={() => act.scope('project')}
            />
            <Button
              key="scope:session"
              variant={isSession ? 'primary' : 'secondary'}
              label="This session"
              onPress={() => act.scope('session')}
            />
          </Box>
          {caption(kit, scopeHelp)}
          <Select
            key="focus"
            label="Focus this chat on…"
            value={d.focusValue}
            options={d.focusOptions}
            onSelect={value => act.setFocus(value)}
          />
        </Box>
      )}
      {focusBanner}
      {offerBanner}
      {overview}
      <Box flexDirection="column" gap="xs">
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {SHOWS.filter(show => show !== 'unused' || used.isTracking).map(show => (
            <Button
              key={`show:${show}`}
              variant={current.show === show ? 'primary' : 'secondary'}
              label={`${SHOW_LABELS[show]} ${m.counts[show]}`}
              onPress={() => act.show(show)}
            />
          ))}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
          <Box flexGrow={1} flexShrink={1} minWidth={16}>
            <Input
              key="filter"
              placeholder="Find a skill…"
              value={current.filter}
              onInput={value => act.filter(value)}
              onSubmit={value => act.filter(value)}
            />
          </Box>
          <Select
            key="groupBy"
            label="Group"
            value={current.groupBy}
            options={[
              { value: 'topic', label: 'By topic' },
              { value: 'source', label: 'By source' },
            ]}
            onSelect={value => act.groupBy(value === 'source' ? 'source' : 'topic')}
          />
        </Box>
      </Box>
      {noticeLine(kit, d.said)}
      {lastChangeRow(kit, d.lastChange, act)}
      {unusedBanner}
      {current.show === 'unused' && caption(kit, unusedHelp(used))}
      {current.show === 'changed' && m.counts.changed > 0 && (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          {caption(
            kit,
            isSession
              ? 'Switched off for this session only.'
              : isOther
                ? "Changed in that folder's own settings."
                : "Changed in this project's own settings.",
          )}
          <Button key="reset" label={isSession ? 'All back on' : 'Back to default'} onPress={() => act.reset()} />
        </Box>
      )}
      {pv.fileError !== null && (
        <Text color="error" wrap="wrap">{`Can't change ${isOther ? 'that folder' : 'this project'}: ${pv.fileError}.`}</Text>
      )}
      {groups.length > 0 ? (
        groups
      ) : (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text dimColor>Nothing matches.</Text>
          <Button key="clear" label="Show all" onPress={() => act.clearFilters()} />
        </Box>
      )}
      {caption(
        kit,
        isSession
          ? 'Off here: Claude does not see the skill, cannot call it, and /name is refused.'
          : 'Saved in .claude/settings.local.json. Skill files are never changed. Click a skill for details.',
      )}
    </Box>
  )
}
