import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  addLate,
  addStep,
  addTool,
  agentsNote,
  allowanceLine,
  bandLine,
  barSvg,
  contextNote,
  estimateTokens,
  fableMark,
  finish,
  fmtCompact,
  fmtDuration,
  fmtFull,
  fmtPercent,
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
  resetsIn,
  segments,
  toolCalls,
  toolLabel,
  toolsLine,
  totalNote,
  totalOf,
} from '../hooks/logic'

/** A store the test can read back, in place of the engine's. */
const storeOf = (on: On): Map<string, unknown> => {
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  return store
}

/** `/tokens <args>` as typed in the message box. */
const typed = (args: string, command = 'tokens') => ({
  command,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

const usage = (input: number, output: number, read: number, write: number, model = 'claude-opus-5-5') => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  model,
})

const END = {
  endedAt: 20_000,
  durationMs: 14_000,
  reason: 'answer',
  contextAfter: 799_800,
  window: 1_000_000,
  limitsAfter: [
    { kind: 'five_hour', percentUsed: 16, resetsAt: '2026-10-12T05:30:00.000Z' },
    { kind: 'seven_day', percentUsed: 11.5 },
  ],
}

test('/tokens off hides the band and keeps the choice', async ($, on) => {
  const store = storeOf(on)

  const answer = await $.command.run(typed('off'))
  expect(String(answer.text)).toMatch(/band: off/)
  expect(store.get('switches')).toEqual({ band: false, isExpanded: false })

  const expanded = await $.command.run(typed('expand'))
  expect(String(expanded.text)).toMatch(/band: on, expanded/)
  expect(store.get('switches')).toEqual({ band: true, isExpanded: true })

  const byName = await $.command.run(typed('collapse', 'nextphase-task-tokens'))
  expect(String(byName.text)).toMatch(/band: on\./)
  expect(store.get('switches')).toEqual({ band: true, isExpanded: false })
})

test('a tool call passes through this mod unchanged', async ($, on) => {
  mock.store(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(ran.deny).toBeUndefined()
  expect(ran.result).toEqual({ stdout: 'ok', stderr: '', interrupted: false })
})

test('a task sums every call, and a subagent call also goes to its own share', () => {
  const tally = newTally('t1', 6000)
  tally.contextBefore = 796_900
  tally.limitsBefore = { five_hour: 15 }
  addStep(tally, usage(1500, 900, 782_000, 21_400))
  addStep(tally, usage(1600, 1000, 812_200, 0))
  addStep(tally, usage(200, 300, 40_000, 5000, 'claude-sonnet-5-5'), 'agent-a')
  addTool(tally, 'Bash', 2100)
  addTool(tally, 'Bash', 2100)
  addTool(tally, 'Read', 1100)
  const task = finish(tally, END)

  expect(task.counts).toEqual({ input: 3300, output: 2200, cacheRead: 1_634_200, cacheWrite: 26_400 })
  expect(totalOf(task.counts)).toBe(1_666_100)
  expect(newOf(task.counts)).toBe(31_900)
  expect(newCounts(task.counts)).toEqual({ input: 3300, output: 2200, cacheRead: 0, cacheWrite: 26_400 })
  expect(task.calls).toBe(3)
  expect(task.largest).toBe(814_800)
  expect(task.model).toBe('claude-opus-5-5')
  expect(task.agents).toEqual([{ id: 'agent-a', model: 'claude-sonnet-5-5', calls: 1, tokens: 45_500, isLate: false }])
  expect(task.tools.map(tool => tool.name)).toEqual(['Bash', 'Read'])
  expect(task.models).toEqual([
    { id: 'claude-opus-5-5', calls: 2, tokens: 1_620_600 },
    { id: 'claude-sonnet-5-5', calls: 1, tokens: 45_500 },
  ])
  expect(modelsLine(task)).toBe('Opus 5.5 97.3% · Sonnet 5.5 2.7%')
  expect(fableMark(task)).toBe(null)
  expect(task.limits).toEqual([
    { kind: 'five_hour', before: 15, after: 16, resetsAt: '2026-10-12T05:30:00.000Z' },
    { kind: 'seven_day', before: null, after: 11.5, resetsAt: null },
  ])
  expect(allowanceLine(task.limits)).toBe('5h 16% · week 11.5%')
  expect(bandLine(task)).toBe('5h 16% · week 11.5% · 3 calls · 1 subagent · 14s · context 80%')
  const now = Date.parse('2026-10-12T03:20:00.000Z')
  expect(task.limits.map(limit => limitNote(limit, now))).toEqual(['+1% this task · resets in 2h 10m', ''])
  expect(rereadNote(task)).toBe('~545k per call')
  expect(rereadNote({ ...task, calls: 0 })).toBe('')
  expect(totalNote(task)).toBe('1,666,100 in all · largest call 815k')
  expect(agentsNote(task)).toBe('46k tokens, 2.7% of the task')
  expect(toolCalls(task)).toBe(3)
  expect(contextNote(task)).toBe('800k of 1.00M · +2,900 this task')
  expect(contextNote({ ...task, contextBefore: 900_000 })).toBe('800k of 1.00M · compacted during this task')
  expect(toolsLine(task.tools, 1)).toBe('Bash ×2 (~4,200) · +1 more')
  expect(toolsLine([{ name: 'Bash', calls: 2, estimate: 4200 }, { name: 'ToolSearch', calls: 1, estimate: 42 }], 2)).toBe('Bash ×2 (~4,200)')
  expect(toolsLine([{ name: 'ToolSearch', calls: 1, estimate: 42 }], 2)).toBe('')

  const late = addLate(task, usage(100, 100, 800, 0, 'claude-sonnet-5-5'), 'agent-a')
  expect(late.calls).toBe(4)
  expect(late.agents[0]).toEqual({ id: 'agent-a', model: 'claude-sonnet-5-5', calls: 2, tokens: 46_500, isLate: true })
  expect(totalOf(late.counts)).toBe(1_667_100)
  expect(late.models[1]).toEqual({ id: 'claude-sonnet-5-5', calls: 2, tokens: 46_500 })
})

test('a task is marked when a Fable model answered any of its calls', () => {
  const main = newTally('t2', 0)
  addStep(main, usage(100, 200, 5000, 0, 'claude-fable-5-1'))
  const byMain = finish(main, { ...END, limitsAfter: [{ kind: 'seven_day_fable', percentUsed: 42 }] })
  expect(fableMark(byMain)).toBe('Fable 5.1')
  expect(modelsLine(byMain)).toBe('Fable 5.1 100%')
  expect(limitLabel('seven_day_fable')).toBe('Weekly Fable')
  expect(allowanceLine(byMain.limits)).toBe('week fable 42%')

  const helped = newTally('t3', 0)
  addStep(helped, usage(100, 200, 5000, 0))
  addStep(helped, usage(100, 200, 700, 0, 'claude-fable-5-1'), 'agent-f')
  expect(fableMark(finish(helped, END))).toBe('Fable 5.1 (subagent)')
})

test('a window says when it resets, and nothing once that time has passed', () => {
  const now = Date.parse('2026-10-12T03:20:00.000Z')
  expect(resetsIn('2026-10-12T05:30:00.000Z', now)).toBe('resets in 2h 10m')
  expect(resetsIn('2026-10-15T09:20:00.000Z', now)).toBe('resets in 3d 6h')
  expect(resetsIn('2026-10-12T03:00:00.000Z', now)).toBe(null)
  expect(resetsIn(null, now)).toBe(null)
  expect(resetsIn('not a date', now)).toBe(null)
  expect(resetsIn(String(Math.round(now / 1000) + 7800), now)).toBe('resets in 2h 10m')
  expect(limitNote({ kind: 'five_hour', before: 96, after: 2, resetsAt: null }, now)).toBe('window reset')
  expect(limitNote({ kind: 'seven_day', before: 10, after: 10, resetsAt: null }, now)).toBe('<1% this task')
  expect(limitLabel('five_hour')).toBe('5-hour')
  expect(limitLabel('seven_day')).toBe('Weekly')
  expect(limitLabel('spend_limit')).toBe('Spend limit')
})

test('numbers, times and names are written the way the card shows them', () => {
  expect(fmtFull(1_594_200)).toBe('1,594,200')
  expect(fmtFull(980)).toBe('980')
  expect(fmtCompact(1_620_600)).toBe('1.62M')
  expect(fmtCompact(412_300)).toBe('412k')
  expect(fmtCompact(4200)).toBe('4.2k')
  expect(fmtCompact(980)).toBe('980')
  expect(fmtPercent(1_594_200, 1_620_600)).toBe('98.4%')
  expect(fmtPercent(5, 1_000_000)).toBe('<0.1%')
  expect(fmtPercent(0, 10)).toBe('0%')
  expect(fmtPercent(10, 10)).toBe('100%')
  expect(fmtDuration(14_000)).toBe('14s')
  expect(fmtDuration(64_000)).toBe('1m 4s')
  expect(fmtDuration(3_720_000)).toBe('1h 2m')
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-haiku-5-5-20260101')).toBe('Haiku 5.5')
  expect(modelLabel('some-gateway-model')).toBe('some-gateway-model')
  expect(toolLabel('mcp__visualize__show_widget')).toBe('show_widget')
  expect(estimateTokens('abcdefgh')).toBe(2)
  expect(estimateTokens({ stdout: 'abcdefgh' })).toBe(5)
  expect(estimateTokens(undefined)).toBe(0)
})

test('the bar keeps every kind visible and always fills its width', () => {
  const counts = { input: 3100, output: 1900, cacheRead: 1_594_200, cacheWrite: 21_400 }
  const parts = segments(counts, 40)
  expect(parts.map(part => part.key)).toEqual(['output', 'cacheWrite', 'input', 'cacheRead'])
  expect(segments(newCounts(counts), 40).map(part => part.key)).toEqual(['output', 'cacheWrite', 'input'])
  expect(parts.reduce((sum, part) => sum + part.units, 0)).toBe(40)
  expect(parts.every(part => part.units >= 1)).toBe(true)
  expect(segments({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 40)).toEqual([])
  expect(segments({ input: 0, output: 7, cacheRead: 0, cacheWrite: 0 }, 12)).toEqual([{ key: 'output', color: '#D85A30', units: 12 }])
  expect(barSvg(counts, 112, 8)).toMatch(/^<svg [^>]*width="112" height="8"/)
})

test('/tokens reads its argument', () => {
  expect(parseArgs(undefined)).toEqual({ kind: 'open' })
  expect(parseArgs(' ON ')).toEqual({ kind: 'set', change: { band: true } })
  expect(parseArgs('collapse')).toEqual({ kind: 'set', change: { band: true, isExpanded: false } })
  expect(parseArgs('nonsense').kind).toBe('unknown')
})

test('a meter stays quiet until the reading matters', () => {
  expect([10, 70, 89.9, 90, 140].map(meterColor)).toEqual(['#888780', '#EF9F27', '#EF9F27', '#E24B4A', '#E24B4A'])
  expect([0, 0.4, 26, 50, 100, 140].map(percent => meterUnits(percent, 16))).toEqual([0, 1, 4, 8, 16, 16])
  expect(meterSvg(26, 128, 8)).toMatch(/<rect width="33" height="8" rx="4" fill="#888780"\/>/)
})
