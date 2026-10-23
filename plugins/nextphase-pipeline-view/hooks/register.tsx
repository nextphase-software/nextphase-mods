// Live view of a project's milestone pipeline. Every 10 seconds it runs the
// collector the project names in .claude/nextphase-pipeline-view.json (or the
// user-level "collector" option) and draws the snapshot that program prints. The
// pane leads with whether the person owes a decision, then a one-line progress
// strip, the implementer, the review and the newest log lines. A notification
// marks the moments worth looking up for. A collector named by a project's own file
// runs only after the person approves it with `/pipeline allow`, and again after any
// change to it, since a cloned repository could name any program. The plugin sends
// nothing anywhere and estimates no progress. The snapshot format is in the README.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Implementer, Snapshot, Stage, View } from '../types'

const PANE = 'nextphase-pipeline-view'
const snapshot = atom({ plugin: 'nextphase-pipeline-view', key: 'snapshot' } as const, { ok: false, message: 'Collecting…' } as Snapshot)
const view = atom({ plugin: 'nextphase-pipeline-view', key: 'view' } as const, { stages: false, message: false } as View)
const APPROVED = 'approved'

/** The implementer run, under its neutral name or the older `codex`. */
export const implementerOf = (s: Snapshot): Implementer | null | undefined => (s.implementer !== undefined ? s.implementer : s.codex)

/** The decision the person owes now, or null. A collector that sends no `your_turn` has it read from the gates. */
export function yourTurn(s: Snapshot): string | null {
  if (!s.ok || s.done) return null
  if (s.your_turn !== undefined) return s.your_turn || null
  const gate = (s.stages ?? []).find(st => st.gate && st.gate_state === 'waiting')
  return gate ? `${gate.gate}${s.waiting ? `: ${s.waiting}` : ''}` : null
}

export function statusLine(s: Snapshot): string | undefined {
  if (!s.ok || !s.id) return undefined
  if (s.done) return `${s.id} · closed`
  const turn = yourTurn(s)
  if (turn) return `${s.id} · ${s.stage} ${s.stage_name} · your turn: ${turn}`
  const run = implementerOf(s)
  const running = run?.running ? ` · ${run.name ?? 'Implementer'} ${run.elapsed ?? 'running'}` : ''
  return `${s.id} · ${s.stage} ${s.stage_name}${running}`
}

export function marker(stage: Stage): string {
  if (stage.state === 'done') return '✓'
  if (stage.state === 'now') return '●'
  if (stage.state === 'skipped') return '–'
  return stage.gate ? '◇' : '○'
}

export function gateText(stage: Stage): string {
  if (!stage.gate) return ''
  const s = stage.gate_state
  return ` · ${stage.gate}${s === 'passed' ? ' passed' : s === 'waiting' ? ' waiting for you' : s === 'not needed' ? ' not needed' : ''}`
}

/** The next gate not yet passed, as "G3 at stage 8, Merge", or null. */
export function nextGate(s: Snapshot): string | null {
  const st = (s.stages ?? []).find(one => one.gate && one.gate_state !== 'passed' && one.gate_state !== 'not needed')
  return st ? `${st.gate} at stage ${st.n}, ${st.name}` : null
}

/** A text bar of `width` cells for done of total; null when the total is unknown. */
export function bar(done: number, total: number | null | undefined, width = 16): string | null {
  if (!total || total <= 0) return null
  const filled = Math.round((Math.min(done, total) / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** Up to `max` characters, cut after the last whole sentence that fits, else at a word, with an ellipsis. */
export function trimSentence(text: string, max = 200): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const head = t.slice(0, max)
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  if (stop > max / 3) return head.slice(0, stop + 1)
  const space = head.lastIndexOf(' ')
  return `${head.slice(0, space > 0 ? space : max)}…`
}

export const e2eFailed = (summary: string | null | undefined): boolean => !!summary && /\b[1-9]\d* failed\b/.test(summary)

/** What changed between two snapshots that is worth a notification. */
export function transitions(before: Snapshot | undefined, after: Snapshot): string[] {
  if (!before?.ok || !after.ok || before.id !== after.id) return []
  const out: string[] = []
  const id = after.id ?? 'Pipeline'
  const turn = yourTurn(after)
  if (turn && turn !== yourTurn(before)) out.push(`${id}: your turn — ${turn}`)
  const b = implementerOf(before)
  const a = implementerOf(after)
  if (b?.running && a && !a.running) out.push(`${id}: ${a.name ?? 'Implementer'} ${a.label} ${a.failed ? 'failed' : 'finished'}`)
  if (before.review && !before.review.done && after.review?.done) out.push(`${id}: ${after.review.name ?? 'Review'} finished`)
  if (!e2eFailed(before.review?.e2e_summary) && e2eFailed(after.review?.e2e_summary)) out.push(`${id}: browser tests failing — ${after.review?.e2e_summary}`)
  if (!before.done && after.done) out.push(`${id}: closed`)
  return out
}

export const PROJECT_FILE = '.claude/nextphase-pipeline-view.json'

export type Choice = { collector: string; source: 'project' | 'user' | 'none' }

// The project's own file wins; the user-level "Collector command" option is the fallback.
// Only the user-level option is trusted as it stands: the person typed it themselves.
export function chooseCollector(projectFile: string | undefined, option: string): Choice {
  if (projectFile !== undefined) {
    try {
      const value = (JSON.parse(projectFile) as { collector?: unknown }).collector
      if (typeof value === 'string' && value.trim()) return { collector: value.trim(), source: 'project' }
    } catch {
      // An unreadable project file counts as absent.
    }
  }
  const own = option.trim()
  return own ? { collector: own, source: 'user' } : { collector: '', source: 'none' }
}

export function collectorArgv(collector: string): string[] | undefined {
  const path = collector.trim()
  if (!path) return undefined
  return path.endsWith('.py') ? ['python3', '-I', path] : [path]
}

/** The program file a command runs: the script for `python3 -I <script>`, else the command itself. */
export const programOf = (argv: string[]): string => (argv[0] === 'python3' && argv.length >= 3 ? argv[2] ?? '' : argv[0] ?? '')

/** Hex SHA-256 of the command and the program file's bytes; a missing file hashes as missing. */
export async function fingerprint(argv: string[], fileBase64: string | null): Promise<string> {
  const head = new TextEncoder().encode(`${argv.join('\u0000')}\u0000`)
  const body = fileBase64 === null ? new TextEncoder().encode('missing') : Uint8Array.from(atob(fileBase64), ch => ch.charCodeAt(0))
  const all = new Uint8Array(head.length + body.length)
  all.set(head)
  all.set(body, head.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all))
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Origins that are the person themselves; anything else (another plugin, a peer, a schedule) may not approve. */
export const personal = (kind: string): boolean => kind === 'composer' || kind === 'bridge' || kind === 'sdk'

export function needsApproval(argv: string[], changed: boolean): Snapshot {
  return {
    ok: false,
    message: changed
      ? `This project's collector has changed since you approved it. Nothing runs until you approve it again.`
      : `This project asks to run a program every 10 seconds to draw its pipeline. Nothing runs until you approve it.`,
    approval: { command: argv.join(' '), program: programOf(argv), file: PROJECT_FILE },
  }
}

export const NOT_CONFIGURED: Snapshot = {
  ok: false,
  message: `No collector is configured for this project. Add ${PROJECT_FILE} with {"collector": "<path>"}, or set "Collector command" in /config for every project.`,
}

export function parseSnapshot(stdout: string): Snapshot {
  try {
    return JSON.parse(stdout) as Snapshot
  } catch {
    return { ok: false, message: 'The collector did not return JSON.', error: stdout.slice(0, 120) }
  }
}

/** A failed collection keeps the last good snapshot on screen, marked with what went wrong. */
export function afterFailure(previous: Snapshot, problem: string): Snapshot {
  return previous.ok ? { ...previous, stale: problem } : { ok: false, message: problem }
}

const stripColor = (st: Stage): string =>
  st.state === 'now' ? 'suggestion' : st.gate_state === 'waiting' ? 'warning' : st.state === 'todo' ? 'inactive' : 'subtle'

export const register: Register = (on, options) => {
  let argv: string[] | undefined
  let source: Choice['source'] = 'none'
  let collectNow: (() => Promise<void>) | undefined
  let resolveNow: (() => Promise<void>) | undefined
  on('session.start', async ($, e, next) => {
    // The same command under a short name and the plugin's own.
    await $.command.register({ name: 'pipeline', description: "Show this project's milestone pipeline in a pane" })
    await $.command.register({ name: 'nextphase-pipeline-view', description: "Show this project's milestone pipeline in a pane. Short form: /pipeline" })
    const cwd = await $.session.cwd()
    // The first snapshot of a session is the baseline: notifications are for changes seen while it runs.
    let last: Snapshot | undefined
    let ticking = false
    const tell = async (text: string) => {
      if (!(await $.ui.notify(text, { title: 'Pipeline' })).isSent) await $.ui.toast(text)
    }
    const collect = async () => {
      if (!argv) {
        await update($, snapshot, () => NOT_CONFIGURED)
        await $.ui.status(undefined)
        return
      }
      if (source === 'project') {
        const owed = await approvalOwed($, argv, cwd)
        if (owed) {
          last = undefined
          await update($, snapshot, () => owed)
          await $.ui.status('Pipeline: approve this project\'s collector with /pipeline allow')
          return
        }
      }
      let snap: Snapshot
      try {
        const run = await $.process.run(argv, { timeoutMs: 20000 })
        snap = run.exitCode === 0 ? parseSnapshot(run.stdout) : { ok: false, message: `The collector exited ${run.exitCode}.`, error: run.stderr.slice(0, 300) }
      } catch (err) {
        snap = { ok: false, message: 'The collector could not run.', error: String(err).slice(0, 300) }
      }
      if (!snap.ok && snap.error !== undefined && last?.ok) {
        const problem = `${snap.message ?? 'Collection failed'} ${snap.error}`.trim()
        await update($, snapshot, previous => afterFailure(previous, problem))
        return
      }
      for (const text of transitions(last, snap)) await tell(text)
      last = snap
      await update($, snapshot, () => snap)
      await $.ui.status(statusLine(snap))
    }
    // Read at the start and again on each command, so a project file added mid-session
    // counts: session.start runs once per process, and a reload skips an unchanged plugin.
    const resolve = async (): Promise<boolean> => {
      const file = (await $.fs.exists(PROJECT_FILE)) ? await $.fs.read(PROJECT_FILE).catch(() => undefined) : undefined
      const choice = chooseCollector(typeof file === 'string' ? file : undefined, String(options.collector ?? ''))
      const chosen = collectorArgv(choice.collector)
      const changed = chosen?.join('\u0000') !== argv?.join('\u0000') || choice.source !== source
      argv = chosen
      source = choice.source
      if (argv && !ticking) {
        ticking = true
        $.clock.every(10000, () => collect())
      }
      return changed
    }
    collectNow = collect
    resolveNow = async () => {
      if (await resolve()) await collect()
    }
    await resolve()
    void collect()
    return next(e)
  })

  // `/pipeline` opens the pane; `/pipeline allow` approves this project's collector as it
  // stands now; `/pipeline revoke` withdraws that. The same under the plugin's own name.
  on('command.run', { command: 'pipeline' }, async ($, e) => {
    await resolveNow?.()
    return pipelineCommand($, e.args, e.origin.kind, argv, source, collectNow)
  })
  on('command.run', { command: 'nextphase-pipeline-view' }, async ($, e) => {
    await resolveNow?.()
    return pipelineCommand($, e.args, e.origin.kind, argv, source, collectNow)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const v = await read($, view)
    if (s.approval)
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
            <Text weight="bold" color="warning">Approve this project's collector?</Text>
            <Text>{s.message}</Text>
          </Box>
          <Box flexDirection="column">
            <Text dimColor>It would run, from this project's folder:</Text>
            <Text>{s.approval.command}</Text>
            <Text dimColor>as named in {s.approval.file}. Read {s.approval.program} before you approve it.</Text>
          </Box>
          <Text>Type /pipeline allow to approve it, as it is now. Any later change to it asks again.</Text>
        </Box>
      )
    if (!s.ok)
      return (
        <Box flexDirection="column">
          <Text dimColor>{s.message ?? 'No data yet.'}</Text>
          {s.error ? <Text color="error">{s.error}</Text> : null}
        </Box>
      )
    const turn = yourTurn(s)
    const stages = s.stages ?? []
    const total = stages.length || 10
    const gate = nextGate(s)
    const c = implementerOf(s)
    const r = s.review
    const reviewBar = r && !r.done ? bar(r.steps, r.total) : null
    const e2eParts = r?.e2e?.split('/').map(Number)
    const e2eBar = e2eParts && e2eParts.length === 2 && !r?.e2e_summary ? bar(e2eParts[0] ?? 0, e2eParts[1]) : null
    const others = r ? Object.entries(r.exit_codes).filter(([code]) => code !== '0') : []
    const latest = [...(s.events ?? [])].reverse().slice(0, 5)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text weight="bold">{s.id} · {s.title}</Text>
          <Text dimColor>
            {s.done ? 'Closed' : `Stage ${s.stage} of ${total} · ${s.stage_name}`}
            {s.in_stage && !s.done ? ` · ${s.in_stage}` : ''}
          </Text>
        </Box>

        {turn ? (
          <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
            <Text weight="bold" color="warning">Your turn</Text>
            <Text>{turn}</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text color="success">{s.done ? 'Milestone closed. Nothing needed from you.' : 'Nothing needed from you right now.'}</Text>
            {!s.done && s.waiting ? <Text dimColor>Now: {s.waiting}</Text> : null}
          </Box>
        )}

        <Box flexDirection="column">
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {stages.map(st => (
              <Text key={`strip${st.n}`} color={stripColor(st)} weight={st.state === 'now' ? 'bold' : undefined}>
                {marker(st)}
              </Text>
            ))}
            <Text color="suggestion">{s.stage}/{total} {s.stage_name}</Text>
          </Box>
          <Text dimColor>{s.done ? 'All stages done.' : gate ? `Next decision: ${gate}` : 'No decisions left.'}</Text>
          <Button
            key="stages"
            label={v.stages ? 'Hide stages' : 'Show stages'}
            variant="secondary"
            onPress={() => update($, view, now => ({ ...now, stages: !now.stages }))}
          />
          {v.stages ? (
            <Box flexDirection="column">
              {stages.map(st => (
                <Text key={`st${st.n}`} color={stripColor(st)}>
                  {marker(st)} {st.n} {st.name}{gateText(st)}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>

        {c === undefined ? null : (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text weight="semibold">{c?.name ?? 'Implementer'}{c ? ` · ${c.label}` : ''}</Text>
          {!c ? (
            <Text dimColor>No implementer run yet.</Text>
          ) : c.failed ? (
            <Text color="error">Failed: {c.failed}</Text>
          ) : c.running ? (
            <Box flexDirection="column">
              <Text color="suggestion">
                Running · {c.elapsed ?? ''}{c.last_event_ago ? ` · last event ${c.last_event_ago} ago` : ''}
              </Text>
              <Text dimColor>{c.model ?? '?'} · {c.effort ?? '?'}{s.container ? ` · ${s.container}` : ''}</Text>
              {c.latest ? <Text>{trimSentence(c.latest)}</Text> : null}
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text>
                Finished{c.finished_at ? ` ${c.finished_at}` : ''} · {c.model ?? '?'} · {c.effort ?? '?'}
              </Text>
              {c.latest ? (
                <Button
                  key="message"
                  label={v.message ? 'Hide last message' : 'Show last message'}
                  variant="secondary"
                  onPress={() => update($, view, now => ({ ...now, message: !now.message }))}
                />
              ) : null}
              {v.message && c.latest ? <Text dimColor>{c.latest}</Text> : null}
            </Box>
          )}
        </Box>
        )}

        {r === undefined ? null : (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Text weight="semibold">{r?.name ?? 'Review'}</Text>
          {!r ? (
            <Text dimColor>No review run recorded.</Text>
          ) : (
            <Box flexDirection="column">
              {e2eFailed(r.e2e_summary) ? <Text color="error">Browser tests: {r.e2e_summary}</Text> : null}
              <Text color={r.done ? 'success' : undefined}>
                {r.done ? 'Finished · ' : ''}
                {r.steps}{r.total ? ` of ${r.total}` : ''} steps done
              </Text>
              {reviewBar ? <Text color="suggestion">{reviewBar}</Text> : null}
              {!r.done && r.current ? <Text>Now: {r.current}</Text> : null}
              {r.e2e && !e2eFailed(r.e2e_summary) ? (
                <Text>
                  Browser tests {r.e2e}{e2eBar ? `  ${e2eBar}` : ''}{r.e2e_summary ? ` · ${r.e2e_summary}` : ''}
                </Text>
              ) : null}
              {others.length ? (
                <Text dimColor>
                  Other exit codes: {others.map(([code, n]) => `${code} (${n} ${n === 1 ? 'step' : 'steps'})`).join(', ')}
                </Text>
              ) : null}
            </Box>
          )}
        </Box>
        )}

        <Box flexDirection="column">
          <Text weight="semibold">Latest</Text>
          {latest.length === 0 ? <Text dimColor>No log lines yet.</Text> : null}
          {latest.map((ev, i) => (
            <Text key={`ev${i}`} dimColor={i > 0}>
              {ev.at}  {ev.text}
            </Text>
          ))}
        </Box>

        {s.stale ? (
          <Text color="error">Not updating: {s.stale}. Showing data from {s.collected_at}.</Text>
        ) : (
          <Text dimColor>Updated {s.collected_at} · every 10 s</Text>
        )}
      </Box>
    )
  })
}

/** The approval screen when this project's collector, as it stands now, is not approved; else null. */
async function approvalOwed($: EngineInterface, argv: string[], cwd: string): Promise<Snapshot | null> {
  const now = await fingerprint(argv, await programBytes($, programOf(argv)))
  const approved = ((await $.store.get(APPROVED)) ?? {}) as Record<string, string>
  if (approved[cwd] === now) return null
  return needsApproval(argv, approved[cwd] !== undefined)
}

async function programBytes($: EngineInterface, path: string): Promise<string | null> {
  try {
    if (!(await $.fs.exists(path))) return null
    const read = await $.fs.read(path, { as: 'bytes' })
    return typeof read === 'string' ? btoa(read) : read.base64
  } catch {
    return null
  }
}

async function pipelineCommand(
  $: EngineInterface,
  args: string,
  origin: string,
  argv: string[] | undefined,
  source: Choice['source'],
  collectNow: (() => Promise<void>) | undefined,
): Promise<{ text: string }> {
  const word = args.trim().toLowerCase()
  if (word === 'allow' || word === 'revoke') {
    if (!personal(origin)) return { text: 'Only you can approve or revoke a collector, from your own prompt.' }
    if (!argv || source !== 'project') return { text: 'This project names no collector of its own, so there is nothing to approve.' }
    const cwd = await $.session.cwd()
    const approved = { ...(((await $.store.get(APPROVED)) ?? {}) as Record<string, string>) }
    if (word === 'allow') approved[cwd] = await fingerprint(argv, await programBytes($, programOf(argv)))
    else delete approved[cwd]
    await $.store.set(APPROVED, approved)
    await collectNow?.()
    return {
      text: word === 'allow'
        ? `Approved for this project: ${argv.join(' ')}. Any change to it asks again.`
        : 'Approval withdrawn for this project; its collector no longer runs.',
    }
  }
  if (word) return { text: 'Usage: /pipeline, /pipeline allow, /pipeline revoke' }
  await $.ui.open({ id: PANE, title: 'Pipeline' })
  return { text: argv ? 'Pipeline view opened.' : 'Pipeline view opened; no collector is configured for this project.' }
}
