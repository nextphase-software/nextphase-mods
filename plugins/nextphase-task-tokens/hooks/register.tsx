import { atom, read, update } from 'claude-code'
import type { BoxProps, ButtonProps, ElementConstructor, EngineInterface, Register, RenderChildren, SvgProps, TextProps } from 'claude-code'

import type { Counts, Switches, Task } from '../types'
import {
  DEFAULT_SWITCHES,
  HISTORY_SIZE,
  NEW_PARTS,
  NO_TOTALS,
  PARTS,
  addCounts,
  addLate,
  addStep,
  addTool,
  agentsNote,
  bandLine,
  barSvg,
  contextNote,
  contextPercent,
  describeSwitches,
  estimateTokens,
  fableMark,
  finish,
  fmtCompact,
  fmtDuration,
  fmtFull,
  fmtPercent,
  fmtUsed,
  fromUsage,
  isFable,
  limitLabel,
  limitNote,
  meterColor,
  meterSvg,
  meterUnits,
  modelLabel,
  modelsLine,
  newCounts,
  newOf,
  newTally,
  parseArgs,
  rereadNote,
  segments,
  toolCalls,
  toolLabel,
  toolsLine,
  totalNote,
  totalOf,
} from './logic'
import type { Reading, Tally, Usage } from './logic'

// nextphase-task-tokens: the tokens the last task used.
//   band   one row above the prompt: the new tokens, a bar of their kinds, the five-hour and weekly
//          allowance used, calls, time, context; a Fable mark when a Fable model answered a call
//   card   the same band expanded: each kind, the context re-read from the cache, models, subagents,
//          tools, context and each allowance window
//   pane   `/tokens` opens the card with the session's total and the earlier tasks
// A task is one turn: from the prompt to the end of the answer, its subagents' calls included.
// New tokens are what a task added: output, context written to the cache and uncached input. The
// context re-read from the cache on every call is shown apart, so it does not drown the rest.
// The four token counts are the API's. A tool's figure is an estimate from the size of its result.

const PANE = 'nextphase-task-tokens'
const TITLE = 'Task tokens'
const ACCENT = '#d97757'
// The mark a task carries when a Fable model answered any of its calls.
const FABLE = '#7F77DD'
const STORE_KEY = 'switches'
// The bar on a surface that draws SVG: CSS pixels per layout cell, and its height.
const CELL_PX = 8
const BAR_PX = 8

const switches = atom({ plugin: 'nextphase-task-tokens', key: 'switches' } as const, DEFAULT_SWITCHES)
const last = atom({ plugin: 'nextphase-task-tokens', key: 'last' } as const, null)
const history = atom({ plugin: 'nextphase-task-tokens', key: 'history' } as const, [])
const live = atom({ plugin: 'nextphase-task-tokens', key: 'live' } as const, null)
const totals = atom({ plugin: 'nextphase-task-tokens', key: 'totals' } as const, NO_TOTALS)

/** The elements every surface has, and the one only some have. */
type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Svg?: ElementConstructor<SvgProps>
}

const loadSwitches = async ($: EngineInterface): Promise<void> => {
  const stored = await $.store.get(STORE_KEY)
  if (stored !== null && typeof stored === 'object') {
    const { band, isExpanded } = stored as Partial<Switches>
    const merged: Switches = {
      band: typeof band === 'boolean' ? band : DEFAULT_SWITCHES.band,
      isExpanded: typeof isExpanded === 'boolean' ? isExpanded : DEFAULT_SWITCHES.isExpanded,
    }
    await update($, switches, () => merged)
  }
}

const setSwitches = async ($: EngineInterface, change: Partial<Switches>): Promise<Switches> => {
  const changed: Switches = { ...(await read($, switches)), ...change }
  await update($, switches, () => changed)
  await $.store.set(STORE_KEY, changed)
  return changed
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE })

/** The bar of the new tokens' kinds: an SVG where the surface draws one, a row of coloured marks elsewhere. */
const bar = (kit: Kit, counts: Counts, cells: number) => {
  const { Svg, Text } = kit
  const added = newCounts(counts)
  const alt = NEW_PARTS.map(part => `${part.label} ${fmtPercent(added[part.key], newOf(counts))}`).join(', ')
  if (Svg) {
    return <Svg source={barSvg(added, cells * CELL_PX, BAR_PX)} alt={alt} width={cells * CELL_PX} height={BAR_PX} />
  }
  return (
    <Text>
      {segments(added, cells).map(one => (
        <Text color={one.color}>{'━'.repeat(one.units)}</Text>
      ))}
    </Text>
  )
}

/** One kind of token in a row of them: its mark, its name, then the count bold. */
const kind = (kit: Kit, part: { label: string; color: string }, count: string) => {
  const { Box, Text } = kit
  return (
    <Box flexShrink={0}>
      <Text>
        <Text color={part.color}>●</Text> {part.label} <Text bold>{count}</Text>
      </Text>
    </Box>
  )
}

// The label column of the card's meters; `Weekly Fable` is its longest label.
const LABEL = 13
// A meter's width in layout cells.
const METER = 16

/** One figure of the card's activity row: the number bold, what it counts after it, a quieter note last. */
const stat = (kit: Kit, value: number, noun: string, note: string) => {
  const { Box, Text } = kit
  return (
    <Box flexShrink={0}>
      <Text>
        <Text bold>{value}</Text> {noun}
        {note !== '' && <Text dimColor> · {note}</Text>}
      </Text>
    </Box>
  )
}

/**
 * One "how full" row: its label, a meter, the reading, then a note. The meter stays grey
 * until the reading matters: amber from 70%, red from 90%.
 */
const meter = (kit: Kit, label: string, percent: number, unit: string, note: string | null) => {
  const { Box, Svg, Text } = kit
  const filled = meterUnits(percent, METER)
  const strong = percent >= 70 ? meterColor(percent) : undefined
  return (
    <Box alignItems="center">
      <Box width={LABEL} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexShrink={0}>
        {Svg ? (
          <Svg source={meterSvg(percent, METER * CELL_PX, BAR_PX)} alt={`${label} ${fmtUsed(percent)} ${unit}`} width={METER * CELL_PX} height={BAR_PX} />
        ) : (
          <Text>
            <Text color={meterColor(percent)}>{'━'.repeat(filled)}</Text>
            <Text dimColor>{'─'.repeat(METER - filled)}</Text>
          </Text>
        )}
      </Box>
      <Box width={11} flexShrink={0} justifyContent="flex-end">
        <Text>
          <Text bold color={strong}>
            {fmtUsed(percent)}
          </Text>{' '}
          {unit}
        </Text>
      </Box>
      {note !== null && note !== '' && (
        <Box paddingLeft={2}>
          <Text dimColor wrap="truncate-end">
            {note}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * The card in four parts: the new tokens with their bar and kinds; the context re-read from the
 * cache; one activity row (subagents, tool calls), there only when a task had some; then a meter
 * each for the context window and every allowance window (five-hour, weekly). `isDetailed` adds
 * the exact total and lists each subagent and tool on its own row.
 */
const card = (kit: Kit, task: Task, columns: number, now: number, isDetailed: boolean, actions: RenderChildren) => {
  const { Box, Text } = kit
  const cells = Math.max(12, Math.min(60, columns - 6))
  const calls = task.calls === 0 ? '' : ` · ${task.calls} ${task.calls === 1 ? 'call' : 'calls'}`
  const cut = task.reason === 'aborted' ? ' · interrupted' : task.reason === 'error' ? ' · ended on an error' : ''
  const fable = fableMark(task)
  const models = task.models ?? []
  const percent = contextPercent(task)
  const reread = PARTS.find(part => part.key === 'cacheRead')
  const note = rereadNote(task)

  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Box gap={1}>
          <Text bold color={ACCENT}>
            ◆
          </Text>
          <Text bold>{TITLE}</Text>
          <Text dimColor wrap="truncate-end">
            {modelLabel(task.model)} · {fmtDuration(task.durationMs)}
            {calls}
            {cut}
          </Text>
          {fable !== null && (
            <Box flexShrink={0}>
              <Text bold color={FABLE}>
                ✦ {fable}
              </Text>
            </Box>
          )}
        </Box>
        {actions}
      </Box>
      <Text>
        <Text bold>{fmtCompact(newOf(task.counts))}</Text> new tokens this task
      </Text>
      {bar(kit, task.counts, cells)}
      <Box columnGap={3} flexWrap="wrap">
        {NEW_PARTS.filter(part => task.counts[part.key] > 0).map(part => kind(kit, part, fmtFull(task.counts[part.key])))}
      </Box>
      {reread !== undefined && task.counts.cacheRead > 0 && (
        <Box marginTop={1} columnGap={1} flexWrap="wrap">
          {kind(kit, reread, fmtCompact(task.counts.cacheRead))}
          {note !== '' && <Text dimColor>· {note}</Text>}
        </Box>
      )}
      {isDetailed && <Text dimColor>{totalNote(task)}</Text>}
      {(task.agents.length > 0 || task.tools.length > 0) && (
        <Box marginTop={1} columnGap={4} flexWrap="wrap">
          {task.agents.length > 0 && stat(kit, task.agents.length, task.agents.length === 1 ? 'subagent' : 'subagents', agentsNote(task))}
          {task.tools.length > 0 &&
            stat(kit, toolCalls(task), toolCalls(task) === 1 ? 'tool call' : 'tool calls', isDetailed ? '' : toolsLine(task.tools, 2))}
        </Box>
      )}
      {(models.length > 1 || fable !== null) && (
        <Text dimColor wrap="truncate-end">
          Models: {modelsLine(task)}
        </Text>
      )}
      {isDetailed &&
        task.agents.map(agent => (
          <Text dimColor wrap="truncate-end">
            Subagent: <Text color={isFable(agent.model) ? FABLE : undefined}>{modelLabel(agent.model)}</Text> · {agent.calls}{' '}
            {agent.calls === 1 ? 'call' : 'calls'} · {fmtFull(agent.tokens)}
            {agent.isLate ? ' · finished late' : ''}
          </Text>
        ))}
      {isDetailed &&
        task.tools.map(tool => (
          <Text dimColor wrap="truncate-end">
            Tool: {toolLabel(tool.name)} ×{tool.calls} · ~{fmtFull(tool.estimate)}
          </Text>
        ))}
      {(percent !== null || task.limits.length > 0) && (
        <Box flexDirection="column" marginTop={1}>
          {percent !== null && meter(kit, 'Context', percent, 'full', contextNote(task))}
          {task.limits.map(limit => meter(kit, limitLabel(limit.kind), limit.after, 'used', limitNote(limit, now)))}
        </Box>
      )}
    </Box>
  )
}

// The task being counted. Lost on a reload; the finished ones are kept in the session's state.
const counting: { current: Tally | null } = { current: null }

const limitsOf = async ($: EngineInterface): Promise<{ context: number | null; window: number | null; limits: Reading[] }> => {
  const usage = await $.session.usage()
  const limits = usage.rateLimits.map((limit): Reading => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt }))
  return { context: usage.context.tokens ?? null, window: usage.context.window || null, limits }
}

const begin = async ($: EngineInterface, turnId: string): Promise<void> => {
  const tally = newTally(turnId, await $.clock.now())
  const before = await limitsOf($)
  tally.contextBefore = before.context
  tally.limitsBefore = Object.fromEntries(before.limits.map(limit => [limit.kind, limit.percentUsed]))
  counting.current = tally
  await update($, live, () => ({ calls: 0, tokens: 0 }))
}

/** One model call's usage: to the running task, or to the last one when its subagent ran on. */
const record = async ($: EngineInterface, usage: Usage, turnId: string, agentId?: string): Promise<void> => {
  if (counting.current === null && agentId !== undefined) {
    const task = await read($, last)
    if (task !== null) {
      const late = addLate(task, usage, agentId)
      await update($, last, () => late)
      await update($, history, list => list.map(one => (one.id === late.id ? late : one)))
      await update($, totals, now => ({ ...now, counts: addCounts(now.counts, fromUsage(usage)) }))
    }
    return
  }
  const tally = counting.current ?? newTally(turnId, await $.clock.now())
  counting.current = tally
  addStep(tally, usage, agentId)
  const running = { calls: tally.calls, tokens: totalOf(tally.counts) }
  await update($, live, () => running)
}

const close = async ($: EngineInterface, e: { turnId: string; durationMs: number; reason: string; usage?: Usage }): Promise<void> => {
  const endedAt = await $.clock.now()
  const tally = counting.current ?? newTally(e.turnId, endedAt - e.durationMs)
  counting.current = null
  // No call of this turn was seen (the mod loaded mid-turn): the turn's own sum is the fallback.
  if (tally.calls === 0 && e.usage) {
    tally.counts = fromUsage(e.usage)
    tally.model = e.usage.model ?? ''
  }
  await update($, live, () => null)
  if (totalOf(tally.counts) === 0) {
    return
  }
  const after = await limitsOf($)
  const task = finish(tally, {
    endedAt,
    durationMs: e.durationMs,
    reason: e.reason,
    contextAfter: after.context,
    window: after.window,
    limitsAfter: after.limits,
  })
  await update($, last, () => task)
  await update($, history, list => [task, ...list].slice(0, HISTORY_SIZE))
  await update($, totals, now => ({ tasks: now.tasks + 1, counts: addCounts(now.counts, task.counts) }))
}

/** What `/tokens` and `/nextphase-task-tokens` answer: the pane opened, or the band switched. */
const runCommand = async ($: EngineInterface, args: string): Promise<{ text: string }> => {
  const asked = parseArgs(args)
  if (asked.kind === 'unknown') {
    return { text: asked.reason }
  }
  if (asked.kind === 'set') {
    return { text: `${TITLE}: ${describeSwitches(await setSwitches($, asked.change))}.` }
  }
  await openPane($)
  return { text: `${TITLE} pane opened. ${describeSwitches(await read($, switches))}.` }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The same command under the mod's own name and a short one.
    await $.command.register({
      name: 'nextphase-task-tokens',
      description: 'Task tokens: opens the pane; add on|off to show or hide the band, expand|collapse for the card. Short form: /tokens',
    })
    await $.command.register({
      name: 'tokens',
      description: 'Task tokens: /tokens opens the pane; /tokens on|off shows or hides the band; /tokens expand|collapse',
    })
    await loadSwitches($)

    return next(e)
  })

  on('command.run', { command: 'tokens' }, ($, e) => runCommand($, e.args))
  on('command.run', { command: 'nextphase-task-tokens' }, ($, e) => runCommand($, e.args))

  // Counting never changes a turn: each hook passes the event on as it is, and a failure here is dropped.
  on('turn.start', async ($, e, next) => {
    try {
      await begin($, e.turnId)
    } catch {
      counting.current = null
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      if (result.usage) {
        await record($, result.usage, e.turnId, e.agentId)
      }
    } catch {
      // The call is not counted.
    }

    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    try {
      if (counting.current !== null) {
        addTool(counting.current, e.tool, result.deny === undefined ? estimateTokens(result.result) : 0)
      }
    } catch {
      // The tool is not counted.
    }

    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      if (e.agentId === undefined) {
        await close($, e)
      }
    } catch {
      counting.current = null
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    const now = await read($, switches)
    if (!now.band || e.props.hasSurvey) {
      return rest
    }
    const task = await read($, last)
    const running = await read($, live)
    const isCounting = running !== null && e.props.isWorking
    if (task === null && !isCounting) {
      return rest
    }
    const kit: Kit = $.ui.resolve(e)
    const { Box, Button, Text } = kit
    const columns = e.props.bodyColumns

    if (isCounting || task === null) {
      return (
        <Box flexDirection="column">
          {rest}
          <Box gap={1}>
            <Text bold color={ACCENT}>
              ◆
            </Text>
            <Text dimColor>
              Counting · {running?.calls ?? 0} {running?.calls === 1 ? 'call' : 'calls'} · {fmtCompact(running?.tokens ?? 0)} tokens so far
            </Text>
          </Box>
        </Box>
      )
    }

    if (now.isExpanded) {
      const actions = (
        <Box gap={1} flexShrink={0}>
          <Button key="tokens-history" label="History" variant="secondary" onPress={() => openPane($)} />
          <Button key="tokens-collapse" label="Collapse" variant="secondary" onPress={() => setSwitches($, { isExpanded: false })} />
        </Box>
      )
      return (
        <Box flexDirection="column">
          {rest}
          {card(kit, task, columns, await $.clock.now(), false, actions)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {rest}
        <Box gap={1} alignItems="center">
          <Text bold color={ACCENT}>
            ◆
          </Text>
          <Box flexShrink={0}>
            <Text bold>{fmtCompact(newOf(task.counts))} new tokens</Text>
          </Box>
          {fableMark(task) !== null && (
            <Box flexShrink={0}>
              <Text bold color={FABLE}>
                ✦ {fableMark(task)}
              </Text>
            </Box>
          )}
          {columns >= 70 && <Box flexShrink={0}>{bar(kit, task.counts, 14)}</Box>}
          <Text dimColor wrap="truncate-end">
            {bandLine(task)}
          </Text>
          <Box gap={1} flexShrink={0}>
            <Button key="tokens-expand" label="Details" variant="secondary" onPress={() => setSwitches($, { isExpanded: true })} />
            <Button key="tokens-hide" label="Hide" variant="secondary" onPress={() => setSwitches($, { band: false })} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit: Kit = $.ui.resolve(e)
    const { Box, Button, Text } = kit
    const now = await read($, switches)
    const task = await read($, last)
    const earlier = (await read($, history)).slice(1)
    const sum = await read($, totals)
    const columns = e.props.bodyColumns
    const clock = await $.clock.now()

    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between" alignItems="center">
          <Text bold>{TITLE}</Text>
          <Box gap={1} alignItems="center">
            <Text dimColor>Band</Text>
            <Button
              key="tokens-band"
              label={now.band ? 'On' : 'Off'}
              variant={now.band ? 'primary' : 'secondary'}
              onPress={() => setSwitches($, { band: !now.band })}
            />
          </Box>
        </Box>

        {task === null ? (
          <Text dimColor>No task counted yet. The card appears when the next task ends.</Text>
        ) : (
          card(kit, task, columns, clock, true, null)
        )}

        <Box flexDirection="column">
          <Text dimColor>SESSION</Text>
          <Text>
            <Text bold>{fmtCompact(newOf(sum.counts))}</Text> new tokens over {sum.tasks} {sum.tasks === 1 ? 'task' : 'tasks'}
          </Text>
          {newOf(sum.counts) > 0 && bar(kit, sum.counts, Math.max(12, Math.min(60, columns - 2)))}
          {totalOf(sum.counts) > 0 && (
            <Text dimColor wrap="truncate-end">
              {PARTS.map(part => `${part.label.toLowerCase()} ${fmtCompact(sum.counts[part.key])}`).join(' · ')} · {fmtFull(totalOf(sum.counts))}{' '}
              in all
            </Text>
          )}
        </Box>

        {earlier.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>EARLIER TASKS</Text>
            {earlier.map(one => (
              <Box gap={1} alignItems="center">
                <Box width={7} flexShrink={0} justifyContent="flex-end">
                  <Text bold>{fmtCompact(newOf(one.counts))}</Text>
                </Box>
                <Box flexShrink={0}>{bar(kit, one.counts, 10)}</Box>
                {fableMark(one) !== null && (
                  <Box flexShrink={0}>
                    <Text bold color={FABLE}>
                      ✦ Fable
                    </Text>
                  </Box>
                )}
                <Text dimColor wrap="truncate-end">
                  new · {fmtCompact(one.counts.cacheRead)} re-read · {one.calls} {one.calls === 1 ? 'call' : 'calls'} ·{' '}
                  {fmtDuration(one.durationMs)} · {fmtDuration(clock - one.endedAt)} ago
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Text dimColor>
          Counts are the API's, summed over every model call of the task, subagents included. New tokens are what a task added: output
          (thinking included), context written to the cache and uncached input. Re-read is the conversation served from the cache again
          on each call. Tool figures are estimates from the size of each result. The 5-hour and weekly figures are the share of your
          plan's allowance used, as the last response reported it.
        </Text>
      </Box>
    )
  })
}
