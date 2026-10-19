export type Stage = {
  n: number
  name: string
  state: 'done' | 'now' | 'todo' | 'skipped'
  gate: string | null
  gate_state: 'passed' | 'not needed' | 'waiting' | 'ahead' | 'not recorded' | null
}
export type Implementer = {
  /** Who ran, as shown: "Codex", for example. Defaults to "Implementer". */
  name?: string | null
  label: string
  thread: string | null
  model: string | null
  effort: string | null
  running: boolean
  failed: string | null
  finished: boolean
  elapsed: string | null
  last_event_ago: string | null
  /** When the run ended, "HH:MM". */
  finished_at?: string | null
  latest: string | null
}
/** The older name of `Implementer`. */
export type Codex = Implementer
export type Review = {
  /** The box heading: "Review · macOS", for example. Defaults to "Review". */
  name?: string | null
  /** Steps finished so far. */
  steps: number
  /** Steps the review plans to run, when known: a count, not an estimate. */
  total?: number | null
  exit_codes: Record<string, number>
  current: string | null
  e2e: string | null
  e2e_summary: string | null
  done: boolean
}
export type Snapshot = {
  ok: boolean
  message?: string
  id?: string
  title?: string
  stage?: number
  stage_name?: string
  done?: boolean
  /** What the pipeline is busy with, in plain words. */
  waiting?: string | null
  /** The decision the person owes now, in plain words, or null when nothing is needed. Absent: read from a gate whose gate_state is "waiting". */
  your_turn?: string | null
  fix_round?: number | null
  in_stage?: string | null
  stages?: Stage[]
  /** The latest implementer run. Absent: the pane shows no implementer box. */
  implementer?: Implementer | null
  /** The older name of `implementer`, still read when `implementer` is absent. */
  codex?: Implementer | null
  review?: Review | null
  /** The state of whatever the implementer runs in, shown as written: "Colima running", for example. */
  container?: string
  events?: { at: string; text: string }[]
  collected_at?: string
  error?: string
  /** Set by the plugin when a later collection failed: the snapshot is the last good one. */
  stale?: string
  /** Set by the plugin while this project's collector awaits the person's approval. */
  approval?: { command: string; program: string; file: string }
}
/** Which collapsed parts of the pane are open. */
export type View = { stages: boolean; message: boolean }

declare module 'claude-code' {
  interface PluginState {
    'nextphase-pipeline-view': { snapshot: Snapshot; view: View }
  }
}
