import type { AgentTally, Counts, Limit, ModelTally, Switches, Task, ToolTally, Totals } from '../types'

// The parts of nextphase-task-tokens that draw nothing: counting, formatting and argument parsing.

export const DEFAULT_SWITCHES: Switches = { band: true, isExpanded: false }
export const HISTORY_SIZE = 10
export const ZERO: Counts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
export const NO_TOTALS: Totals = { tasks: 0, counts: ZERO }

/**
 * The four kinds of token, in the order the bar and the rows show them: what the task
 * added first, the context re-read from the cache last.
 */
export const PARTS: readonly { key: keyof Counts; label: string; color: string }[] = [
  { key: 'output', label: 'Output', color: '#D85A30' },
  { key: 'cacheWrite', label: 'Added to context', color: '#EF9F27' },
  { key: 'input', label: 'Uncached input', color: '#378ADD' },
  { key: 'cacheRead', label: 'Re-read from cache', color: '#1D9E75' },
]

/** The kinds a task adds: everything but the context it re-read from the cache. */
export const NEW_PARTS = PARTS.filter(part => part.key !== 'cacheRead')

/** A tool is named beside the tool-call count only when its results came to this many tokens or more. */
export const TOOL_NOTE_MIN = 1000

/** What the API reports for one model call. */
export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model?: string
}

/** A task still being counted. */
export type Tally = {
  turnId: string
  startedAt: number
  counts: Counts
  calls: number
  largest: number
  model: string
  models: Record<string, ModelTally>
  agents: Record<string, AgentTally>
  tools: Record<string, ToolTally>
  contextBefore: number | null
  limitsBefore: Record<string, number>
}

/** One allowance window as the host reports it now. */
export type Reading = { kind: string; percentUsed: number; resetsAt?: string }

export const fromUsage = (usage: Usage): Counts => ({
  input: usage.input_tokens || 0,
  output: usage.output_tokens || 0,
  cacheRead: usage.cache_read_input_tokens || 0,
  cacheWrite: usage.cache_creation_input_tokens || 0,
})

export const addCounts = (a: Counts, b: Counts): Counts => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

export const totalOf = (counts: Counts): number => counts.input + counts.output + counts.cacheRead + counts.cacheWrite

/** The tokens a task added: output, context written to the cache and uncached input. */
export const newOf = (counts: Counts): number => counts.input + counts.output + counts.cacheWrite

/** The same counts without the cache re-reads, for a bar of what the task added. */
export const newCounts = (counts: Counts): Counts => ({ ...counts, cacheRead: 0 })

export const newTally = (turnId: string, startedAt: number): Tally => ({
  turnId,
  startedAt,
  counts: ZERO,
  calls: 0,
  largest: 0,
  model: '',
  models: {},
  agents: {},
  tools: {},
  contextBefore: null,
  limitsBefore: {},
})

/** Adds one model call to the task; a call with an `agentId` also goes to that subagent's share. */
export const addStep = (tally: Tally, usage: Usage, agentId?: string): void => {
  const counts = fromUsage(usage)
  const tokens = totalOf(counts)
  tally.counts = addCounts(tally.counts, counts)
  tally.calls += 1
  tally.largest = Math.max(tally.largest, tokens)
  const id = usage.model || 'unknown'
  const model = tally.models[id] ?? { id, calls: 0, tokens: 0 }
  tally.models[id] = { id, calls: model.calls + 1, tokens: model.tokens + tokens }
  if (agentId === undefined) {
    tally.model = usage.model || tally.model
    return
  }
  const agent = tally.agents[agentId] ?? { id: agentId, model: '', calls: 0, tokens: 0, isLate: false }
  tally.agents[agentId] = { ...agent, model: usage.model || agent.model, calls: agent.calls + 1, tokens: agent.tokens + tokens }
}

export const addTool = (tally: Tally, name: string, estimate: number): void => {
  const tool = tally.tools[name] ?? { name, calls: 0, estimate: 0 }
  tally.tools[name] = { name, calls: tool.calls + 1, estimate: tool.estimate + estimate }
}

/** The finished task, its subagents and tools largest first. */
export const finish = (
  tally: Tally,
  end: { endedAt: number; durationMs: number; reason: string; contextAfter: number | null; window: number | null; limitsAfter: readonly Reading[] },
): Task => ({
  id: tally.turnId,
  endedAt: end.endedAt,
  durationMs: end.durationMs,
  model: tally.model,
  reason: end.reason,
  calls: tally.calls,
  largest: tally.largest,
  counts: tally.counts,
  models: Object.values(tally.models).sort((a, b) => b.tokens - a.tokens),
  agents: Object.values(tally.agents).sort((a, b) => b.tokens - a.tokens),
  tools: Object.values(tally.tools).sort((a, b) => b.estimate - a.estimate || b.calls - a.calls),
  contextBefore: tally.contextBefore,
  contextAfter: end.contextAfter,
  window: end.window,
  limits: end.limitsAfter.map(
    (now): Limit => ({
      kind: now.kind,
      before: tally.limitsBefore[now.kind] ?? null,
      after: now.percentUsed,
      resetsAt: now.resetsAt ?? null,
    }),
  ),
})

const addModel = (models: readonly ModelTally[], id: string, tokens: number): ModelTally[] => {
  const known = models.find(model => model.id === id)
  const model: ModelTally = { id, calls: (known?.calls ?? 0) + 1, tokens: (known?.tokens ?? 0) + tokens }
  return [...models.filter(one => one.id !== id), model].sort((a, b) => b.tokens - a.tokens)
}

/** A subagent's call that arrived after its task had ended, added to that task and marked late. */
export const addLate = (task: Task, usage: Usage, agentId: string): Task => {
  const counts = fromUsage(usage)
  const tokens = totalOf(counts)
  const known = task.agents.find(agent => agent.id === agentId)
  const agent: AgentTally = {
    id: agentId,
    model: usage.model || known?.model || '',
    calls: (known?.calls ?? 0) + 1,
    tokens: (known?.tokens ?? 0) + tokens,
    isLate: true,
  }
  return {
    ...task,
    counts: addCounts(task.counts, counts),
    calls: task.calls + 1,
    largest: Math.max(task.largest, tokens),
    models: addModel(task.models ?? [], usage.model || 'unknown', tokens),
    agents: [...task.agents.filter(one => one.id !== agentId), agent].sort((a, b) => b.tokens - a.tokens),
  }
}

/** Result size in characters divided by four: a rough token estimate, never an API count. */
export const estimateTokens = (value: unknown): number => {
  if (value === undefined || value === null) {
    return 0
  }
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return Math.round((text?.length ?? 0) / 4)
  } catch {
    return 0
  }
}

/** 1594200 as `1,594,200`. */
export const fmtFull = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** 1620600 as `1.62M`, 412300 as `412k`, 980 as `980`. */
export const fmtCompact = (n: number): string => {
  if (n >= 999_500) {
    const millions = n / 1_000_000
    return `${millions >= 100 ? millions.toFixed(0) : millions >= 10 ? millions.toFixed(1) : millions.toFixed(2)}M`
  }
  if (n >= 10_000) {
    return `${Math.round(n / 1000)}k`
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return String(Math.round(n))
}

export const fmtPercent = (part: number, total: number): string => {
  if (total <= 0 || part <= 0) {
    return '0%'
  }
  const percent = (part / total) * 100
  if (percent < 0.1) {
    return '<0.1%'
  }
  return percent >= 99.95 ? '100%' : `${percent.toFixed(1)}%`
}

/** 14000 as `14s`, 64000 as `1m 4s`, 3720000 as `1h 2m`. */
export const fmtDuration = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

/** `claude-opus-5-5` as `Opus 5.5`; an id of another shape as it is. */
export const modelLabel = (id: string): string => {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id)
  if (!match?.[1] || !match[2]) {
    return id || 'unknown model'
  }
  const name = match[1].charAt(0).toUpperCase() + match[1].slice(1)
  return match[3] ? `${name} ${match[2]}.${match[3]}` : `${name} ${match[2]}`
}

/** `mcp__visualize__show_widget` as `show_widget`. */
export const toolLabel = (name: string): string => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) || name : name)

/** True for a Fable model's id, `claude-fable-5-1`. */
export const isFable = (id: string): boolean => /fable/i.test(id)

/** The Fable models a task's calls were answered by, the main loop's or a subagent's. */
export const fableModels = (task: Task): ModelTally[] => (task.models ?? []).filter(model => isFable(model.id))

/** The band's Fable mark: `Fable 5.1`, or with `(subagent)` when only a subagent used it; null when none did. */
export const fableMark = (task: Task): string | null => {
  const used = fableModels(task)[0]
  if (used === undefined) {
    return null
  }
  return isFable(task.model) ? modelLabel(used.id) : `${modelLabel(used.id)} (subagent)`
}

/** `five_hour` as `5-hour`, `seven_day` as `Weekly`, a model's own weekly window as `Weekly Fable`. */
export const limitLabel = (kind: string): string => {
  if (kind === 'five_hour') {
    return '5-hour'
  }
  if (kind === 'seven_day') {
    return 'Weekly'
  }
  const own = /^seven_day_(.+)$/.exec(kind)?.[1]
  const words = (own ?? kind).replace(/_/g, ' ')
  return own === undefined ? words.charAt(0).toUpperCase() + words.slice(1) : `Weekly ${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** The band's short name for a window: `5h`, `week`, `week fable`. */
export const limitShort = (kind: string): string =>
  kind === 'five_hour' ? '5h' : kind === 'seven_day' ? 'week' : limitLabel(kind).replace(/^Weekly /, 'week ').toLowerCase()

/** 23.5 as `23.5%`, 7 as `7%`. */
export const fmtUsed = (percent: number): string => `${Math.round(percent * 10) / 10}%`

/** `resets in 2h 10m` for a window's reset time (ISO 8601, or epoch seconds or milliseconds); null when absent, unreadable or past. */
export const resetsIn = (resetsAt: string | number | null | undefined, now: number): string | null => {
  const numeric = typeof resetsAt === 'number' ? resetsAt : typeof resetsAt === 'string' && /^\d+(\.\d+)?$/.test(resetsAt) ? Number(resetsAt) : null
  const at = numeric !== null ? (numeric < 1e11 ? numeric * 1000 : numeric) : typeof resetsAt === 'string' ? Date.parse(resetsAt) : Number.NaN
  if (Number.isNaN(at) || at <= now) {
    return null
  }
  const days = Math.floor((at - now) / 86_400_000)
  return days >= 1 ? `resets in ${days}d ${Math.floor(((at - now) % 86_400_000) / 3_600_000)}h` : `resets in ${fmtDuration(at - now)}`
}

/**
 * What a window's row says beside its meter: what the task added, then when the window resets.
 * A task too small to move the reading reads `<1% this task`; a reading that fell, `window reset`.
 */
export const limitNote = (limit: Limit, now: number): string => {
  const added = limit.before === null ? null : Math.round((limit.after - limit.before) * 10) / 10
  const share = added === null ? null : added < 0 ? 'window reset' : added === 0 ? '<1% this task' : `+${added}% this task`
  return [share, resetsIn(limit.resetsAt, now)].filter((part): part is string => part !== null).join(' · ')
}

/** What the context row says beside its meter: `258k of 1.00M · +35,982 this task`. */
export const contextNote = (task: Task): string | null => {
  if (task.contextAfter === null) {
    return null
  }
  const size = `${fmtCompact(task.contextAfter)}${task.window ? ` of ${fmtCompact(task.window)}` : ''}`
  if (task.contextBefore === null) {
    return size
  }
  const added = task.contextAfter - task.contextBefore
  return added < 0 ? `${size} · compacted during this task` : `${size} · +${fmtFull(added)} this task`
}

/** A meter's colour: quiet until the reading matters, amber from 70%, red from 90%. */
export const meterColor = (percent: number): string => (percent >= 90 ? '#E24B4A' : percent >= 70 ? '#EF9F27' : '#888780')

/** How many of a meter's `cells` are filled: in proportion, at least one for any reading above zero, never more than all. */
export const meterUnits = (percent: number, cells: number): number =>
  percent <= 0 ? 0 : Math.min(cells, Math.max(1, Math.round((Math.min(percent, 100) / 100) * cells)))

/** A meter as an SVG document, `width` by `height` CSS pixels: a faint track, the reading filled over it. */
export const meterSvg = (percent: number, width: number, height: number): string => {
  const radius = height / 2
  const filled = percent <= 0 ? 0 : Math.max(height, Math.round((Math.min(percent, 100) / 100) * width))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${radius}" fill="#888780" fill-opacity="0.25"/>` +
    `<rect width="${filled}" height="${height}" rx="${radius}" fill="${meterColor(percent)}"/></svg>`
  )
}

/** The band's allowance figures: `5h 16% · week 11%`; empty where the host reports no window. */
export const allowanceLine = (limits: readonly Limit[]): string =>
  limits.map(limit => `${limitShort(limit.kind)} ${fmtUsed(limit.after)}`).join(' · ')

/** Each model's share of the task's tokens: `Opus 5.5 97.3% · Sonnet 5.5 2.7%`. */
export const modelsLine = (task: Task): string | null => {
  const models = task.models ?? []
  if (models.length === 0) {
    return null
  }
  const total = totalOf(task.counts)
  return models.map(model => `${modelLabel(model.id)} ${fmtPercent(model.tokens, total)}`).join(' · ')
}

/**
 * The bar's segments over `width` units: each kind in proportion, a kind with any
 * tokens at all at least one unit so it stays visible, the units summing to `width`.
 */
export const segments = (counts: Counts, width: number): { key: keyof Counts; color: string; units: number }[] => {
  const total = totalOf(counts)
  if (total <= 0 || width <= 0) {
    return []
  }
  const found = PARTS.filter(part => counts[part.key] > 0).map(part => ({
    key: part.key,
    color: part.color,
    units: Math.max(1, Math.round((counts[part.key] / total) * width)),
  }))
  const largest = found.reduce((a, b) => (b.units > a.units ? b : a))
  largest.units = Math.max(1, largest.units + width - found.reduce((sum, one) => sum + one.units, 0))
  return found
}

/** The bar as an SVG document, `width` by `height` CSS pixels, ends rounded. */
export const barSvg = (counts: Counts, width: number, height: number): string => {
  let x = 0
  const rects = segments(counts, width)
    .map(one => {
      const rect = `<rect x="${x}" y="0" width="${one.units}" height="${height}" fill="${one.color}"/>`
      x += one.units
      return rect
    })
    .join('')
  const radius = height / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><clipPath id="r"><rect width="${width}" height="${height}" rx="${radius}"/></clipPath></defs>` +
    `<rect width="${width}" height="${height}" rx="${radius}" fill="#888780" fill-opacity="0.3"/>` +
    `<g clip-path="url(#r)">${rects}</g></svg>`
  )
}

/** How full the context window is after the task, in whole percent; null where the host reports none. */
export const contextPercent = (task: Task): number | null =>
  task.contextAfter !== null && task.window ? Math.round((task.contextAfter / task.window) * 100) : null

/** The band's short line: `5h 16% · week 11% · 2 calls · 14s · context 80%`, the allowance first. */
export const bandLine = (task: Task): string => {
  const percent = contextPercent(task)
  const lateOrCut = task.reason === 'aborted' ? 'interrupted' : task.reason === 'error' ? 'ended on an error' : null
  return [
    allowanceLine(task.limits) || null,
    task.calls > 0 ? `${task.calls} ${task.calls === 1 ? 'call' : 'calls'}` : null,
    task.agents.length > 0 ? `${task.agents.length} ${task.agents.length === 1 ? 'subagent' : 'subagents'}` : null,
    fmtDuration(task.durationMs),
    percent === null ? null : `context ${percent}%`,
    lateOrCut,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

/** What the re-read figure says beside it: `~345k per call`; empty when no call was seen. */
export const rereadNote = (task: Task): string =>
  task.calls === 0 || task.counts.cacheRead === 0 ? '' : `~${fmtCompact(task.counts.cacheRead / task.calls)} per call`

/** The pane's exact figures: `1,666,100 in all · largest call 815k`. */
export const totalNote = (task: Task): string =>
  [`${fmtFull(totalOf(task.counts))} in all`, task.calls === 0 ? null : `largest call ${fmtCompact(task.largest)}`]
    .filter((part): part is string => part !== null)
    .join(' · ')

/** What the subagents figure says beside it: `310k tokens, 18.6% of the task`, and whether one finished late. */
export const agentsNote = (task: Task): string => {
  if (task.agents.length === 0) {
    return ''
  }
  const tokens = task.agents.reduce((sum, agent) => sum + agent.tokens, 0)
  const late = task.agents.some(agent => agent.isLate) ? ', some finished late' : ''
  return `${fmtCompact(tokens)} tokens, ${fmtPercent(tokens, totalOf(task.counts))} of the task${late}`
}

/** How many tool calls a task made, over every tool. */
export const toolCalls = (task: Task): number => task.tools.reduce((sum, tool) => sum + tool.calls, 0)

/** The most expensive tools, `Bash ×2 (~4,200)`, with a count of the rest; a tool under `TOOL_NOTE_MIN` is left out. */
export const toolsLine = (tools: readonly ToolTally[], shown: number): string => {
  const large = tools.filter(tool => tool.estimate >= TOOL_NOTE_MIN)
  if (large.length === 0) {
    return ''
  }
  const first = large.slice(0, shown).map(tool => `${toolLabel(tool.name)} ×${tool.calls} (~${fmtFull(tool.estimate)})`)
  return large.length > shown ? `${first.join(' · ')} · +${large.length - shown} more` : first.join(' · ')
}

/** What `/tokens` was asked: open the pane, switch the band, or expand or collapse it. */
export type Asked =
  | { kind: 'open' }
  | { kind: 'set'; change: Partial<Switches> }
  | { kind: 'unknown'; reason: string }

export const parseArgs = (args: string | undefined): Asked => {
  const word = (args ?? '').trim().toLowerCase()
  if (word === '') {
    return { kind: 'open' }
  }
  if (word === 'on' || word === 'off') {
    return { kind: 'set', change: { band: word === 'on' } }
  }
  if (word === 'expand' || word === 'collapse') {
    return { kind: 'set', change: { band: true, isExpanded: word === 'expand' } }
  }
  return { kind: 'unknown', reason: 'Task tokens: use /tokens (or /nextphase-task-tokens) alone, or with on, off, expand or collapse.' }
}

export const describeSwitches = (now: Switches): string => `band: ${now.band ? (now.isExpanded ? 'on, expanded' : 'on') : 'off'}`
