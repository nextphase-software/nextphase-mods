/** The four token counts of one or more model calls, as the API reports them. */
export type Counts = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** One subagent's share of a task. `isLate` marks calls that arrived after the task had ended. */
export type AgentTally = {
  id: string
  model: string
  calls: number
  tokens: number
  isLate: boolean
}

/** One tool's calls in a task. `estimate` is result size in characters divided by four, not an API count. */
export type ToolTally = {
  name: string
  calls: number
  estimate: number
}

/** One model's share of a task: the calls it answered and the tokens they used. */
export type ModelTally = {
  id: string
  calls: number
  tokens: number
}

/** One allowance window (five-hour, weekly) before and after a task, in percent of the allowance used. */
export type Limit = {
  kind: string
  before: number | null
  after: number
  resetsAt: string | null
}

/** One finished task: a turn, from the prompt to the end of the answer, with its subagents. */
export type Task = {
  id: string
  endedAt: number
  durationMs: number
  model: string
  reason: string
  calls: number
  largest: number
  counts: Counts
  models: ModelTally[]
  agents: AgentTally[]
  tools: ToolTally[]
  contextBefore: number | null
  contextAfter: number | null
  window: number | null
  limits: Limit[]
}

/** The running count shown while a task is still working. */
export type Live = {
  calls: number
  tokens: number
}

/** Everything counted since the session's figures began. */
export type Totals = {
  tasks: number
  counts: Counts
}

/** The band on (true) or off (false), and whether it shows the full card. */
export type Switches = {
  band: boolean
  isExpanded: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'nextphase-task-tokens': {
      switches: Switches
      last: Task | null
      history: Task[]
      live: Live | null
      totals: Totals
    }
  }
}
