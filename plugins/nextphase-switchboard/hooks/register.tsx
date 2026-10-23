import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SwitchItem } from '../types'

const PANE = 'nextphase-switchboard'
const TITLE = 'NextPhase Switchboard'
const SELF = 'nextphase-switchboard'

const items = atom({ plugin: 'nextphase-switchboard', key: 'items' } as const, [] as SwitchItem[])
const busy = atom({ plugin: 'nextphase-switchboard', key: 'busy' } as const, '')
const note = atom({ plugin: 'nextphase-switchboard', key: 'note' } as const, '')

type Listed = { id: string; enabled: boolean; installPath?: string }
type Host = EngineInterface

// Reads every installed plugin from the Claude Code CLI, and marks the ones whose
// hooks.json lists modules as mods.
async function load($: Host): Promise<string> {
  const run = await $.process.run(['claude', 'plugin', 'list', '--json'])
  if (run.exitCode !== 0) return `Could not list plugins: ${run.stderr.trim() || `exit ${run.exitCode}`}`
  let listed: Listed[]
  try {
    listed = JSON.parse(run.stdout) as Listed[]
  } catch {
    return 'Could not read the plugin list.'
  }
  const out: SwitchItem[] = []
  for (const p of listed) {
    if (p.id.startsWith(`${SELF}@`)) continue
    const [name = p.id, source = ''] = p.id.split('@')
    let kind: SwitchItem['kind'] = 'plugin'
    if (p.installPath) {
      const hooks = await $.fs.read(`${p.installPath}/hooks/hooks.json`).catch(() => '')
      if (typeof hooks === 'string' && hooks.includes('"modules"')) kind = 'mod'
    }
    out.push({ id: p.id, name, source, enabled: p.enabled, kind })
  }
  out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'mod' ? -1 : 1))
  await update($, items, () => out)
  return ''
}

async function toggle($: Host, item: SwitchItem) {
  if (await read($, busy)) return
  const verb = item.enabled ? 'disable' : 'enable'
  await update($, busy, () => item.id)
  await update($, note, () => `${verb === 'enable' ? 'Turning on' : 'Turning off'} ${item.name}…`)
  const run = await $.process.run(['claude', 'plugin', verb, item.id])
  if (run.exitCode !== 0) {
    await update($, note, () => `Could not ${verb} ${item.name}: ${run.stderr.trim() || run.stdout.trim() || `exit ${run.exitCode}`}`)
    await update($, busy, () => '')
    return
  }
  await update($, items, list => list.map(one => (one.id === item.id ? { ...one, enabled: !item.enabled } : one)))
  let reloaded = true
  await $.command.run({ command: 'reload-plugins' }).catch(() => {
    reloaded = false
  })
  const state = item.enabled ? 'off' : 'on'
  const tail = reloaded
    ? item.kind === 'mod'
      ? 'Plugins reloaded.'
      : 'Plugins reloaded; skills may need a new chat.'
    : 'Run /reload-plugins to apply it here.'
  await update($, note, () => `${item.name} is ${state}. ${tail}`)
  await update($, busy, () => '')
}

async function openPane($: Host) {
  const problem = await load($)
  await update($, note, () => problem)
  await $.ui.open({ id: PANE, title: TITLE })
  return { text: problem || 'Switchboard opened.' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'nextphase-switchboard',
      description: 'Open the NextPhase Switchboard: turn plugins and mods on or off. Short form: /switchboard',
    })
    await $.command.register({
      name: 'switchboard',
      description: 'Open the NextPhase Switchboard: turn plugins and mods on or off',
    })
    return next(e)
  })

  on('command.run', { command: 'nextphase-switchboard' }, async $ => openPane($))
  on('command.run', { command: 'switchboard' }, async $ => openPane($))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, items)
    const working = await read($, busy)
    const message = await read($, note)
    const onCount = list.filter(i => i.enabled).length

    // One card per marketplace, so the source is said once instead of on every row.
    const sources = [...new Set(list.map(i => i.source))].sort((a, b) =>
      a.startsWith('nextphase') === b.startsWith('nextphase') ? a.localeCompare(b) : a.startsWith('nextphase') ? -1 : 1,
    )

    const row = (i: SwitchItem) => (
      <Box key={i.id} flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={1} flexShrink={1}>
          <Text weight="medium" dimColor={!i.enabled} wrap="truncate-end">
            {i.name}
          </Text>
          <Text size="caption" dimColor>
            {i.kind}
          </Text>
        </Box>
        <Button
          key={`toggle-${i.id}`}
          label={working === i.id ? '…' : i.enabled ? 'On' : 'Off'}
          variant={i.enabled ? 'primary' : 'secondary'}
          dimColor={!i.enabled}
          onPress={() => void toggle($, i)}
        />
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text size="footnote" dimColor>
            {onCount} of {list.length} on
          </Text>
          <Button key="refresh" label="Refresh" plain dimColor onPress={() => void load($).then(p => update($, note, () => p))} />
        </Box>
        {message !== '' && <Text size="footnote">{message}</Text>}
        {list.length === 0 && <Text dimColor>No plugins found. Press Refresh.</Text>}
        {sources.map(src => {
          const group = list.filter(i => i.source === src)
          return (
            <Box key={`group-${src}`} flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={1} paddingY={1}>
              <Text size="caption" weight="semibold" dimColor>
                {src.toUpperCase()} · {group.filter(i => i.enabled).length}/{group.length}
              </Text>
              {group.map(row)}
            </Box>
          )
        })}
        <Text size="caption" dimColor>
          A toggle applies in every chat and reloads plugins here. A plain plugin's skills may need a new chat.
        </Text>
      </Box>
    )
  })
}
