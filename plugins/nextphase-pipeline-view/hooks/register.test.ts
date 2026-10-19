import { expect, test } from 'claude-code/testing'
import type { Implementer, Snapshot, Stage } from '../types'
import {
  afterFailure, bar, chooseCollector, collectorArgv, e2eFailed, fingerprint, gateText, implementerOf, marker,
  needsApproval, nextGate, parseSnapshot, personal, programOf, statusLine, transitions, trimSentence, yourTurn,
} from './register'

const NAMES = ['Plan', 'Stage', 'Ready', 'Launch', 'Watch', 'Review', 'Fix loop', 'Merge', 'Publish', 'Close']
const GATES: Record<number, string> = { 1: 'G1', 2: 'G2', 8: 'G3', 9: 'G4' }
const stages = (now: number, waiting = false): Stage[] =>
  NAMES.map((name, i) => {
    const n = i + 1
    const gate = GATES[n] ?? null
    return {
      n, name, gate,
      state: n < now ? 'done' : n === now ? 'now' : 'todo',
      gate_state: !gate ? null : n < now ? 'passed' : n === now && waiting ? 'waiting' : 'ahead',
    }
  })
const codex = (over: Partial<Implementer> = {}): Implementer => ({
  name: 'Codex', label: 'implement-1', thread: null, model: 'm', effort: 'medium', running: true, failed: null,
  finished: false, elapsed: '12m 03s', last_event_ago: null, latest: null, ...over,
})
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ ok: true, id: '0006-W1', stage: 6, stage_name: 'Review', stages: stages(6), ...over })

test('says nothing is owed when the collector records no decision', () => {
  expect(yourTurn(snap({ your_turn: null, waiting: 'review in progress' }))).toBeNull()
})

test('names the decision the collector records', () => {
  expect(yourTurn(snap({ stage: 8, stage_name: 'Merge', your_turn: 'G3: merge after reading the verdict' }))).toBe('G3: merge after reading the verdict')
})

test('reads the decision from a waiting gate when the collector sends no your_turn', () => {
  expect(yourTurn(snap({ stage: 8, stage_name: 'Merge', stages: stages(8, true), waiting: 'merge decision' }))).toBe('G3: merge decision')
  expect(yourTurn(snap({ done: true, stages: stages(8, true) }))).toBeNull()
})

test('puts the owed decision in the status line, else the running implementer', () => {
  expect(statusLine(snap({ stage: 8, stage_name: 'Merge', your_turn: 'G3: merge' }))).toBe('0006-W1 · 8 Merge · your turn: G3: merge')
  expect(statusLine(snap({ stage: 5, stage_name: 'Watch', your_turn: null, codex: codex() }))).toBe('0006-W1 · 5 Watch · Codex 12m 03s')
  expect(statusLine(snap({ stage: 3, stage_name: 'Build', your_turn: null, codex: codex({ name: undefined, elapsed: '4m 10s' }) }))).toBe('0006-W1 · 3 Build · Implementer 4m 10s')
})

test('shows a closed milestone in one short status line', () => {
  expect(statusLine({ ok: true, id: '0005-W1', done: true, stage: 10, stage_name: 'Close' })).toBe('0005-W1 · closed')
})

test('clears the status line when nothing is recorded', () => {
  expect(statusLine({ ok: false })).toBeUndefined()
})

test('marks stages and gates without inventing progress', () => {
  expect(marker({ n: 7, name: 'Fix loop', state: 'skipped', gate: null, gate_state: null })).toBe('–')
  expect(marker({ n: 8, name: 'Merge', state: 'todo', gate: 'G3', gate_state: 'ahead' })).toBe('◇')
  expect(marker({ n: 10, name: 'Close', state: 'todo', gate: null, gate_state: null })).toBe('○')
  expect(gateText({ n: 1, name: 'Plan', state: 'done', gate: 'G1', gate_state: 'not needed' })).toBe(' · G1 not needed')
  expect(gateText({ n: 8, name: 'Merge', state: 'now', gate: 'G3', gate_state: 'waiting' })).toBe(' · G3 waiting for you')
})

test('names the next gate still ahead', () => {
  expect(nextGate(snap())).toBe('G3 at stage 8, Merge')
  expect(nextGate(snap({ stages: stages(11) }))).toBeNull()
})

test('draws a bar only for a known total', () => {
  expect(bar(40, 48, 12)).toBe('██████████░░')
  expect(bar(5, null)).toBeNull()
  expect(bar(60, 48, 4)).toBe('████')
})

test('cuts a long message after a whole sentence', () => {
  const text = 'Implemented v1 on the branch. Final tip: a133c7d. Worktree clean. Linux validation passed across twelve projects and more words follow here.'
  expect(trimSentence(text, 80)).toBe('Implemented v1 on the branch. Final tip: a133c7d. Worktree clean.')
  expect(trimSentence('short', 80)).toBe('short')
  expect(trimSentence('one very long sentence without any stop at all in it', 20)).toBe('one very long…')
})

test('notifies when a decision becomes owed, a run ends, or browser tests fail', () => {
  const running = snap({ your_turn: null, codex: codex(), review: { steps: 3, exit_codes: { '0': 3 }, current: 'x', e2e: null, e2e_summary: null, done: false } })
  expect(transitions(undefined, running)).toEqual([])
  const after = snap({
    stage: 8, stage_name: 'Merge', your_turn: 'G3: merge',
    codex: codex({ running: false, finished: true }),
    review: { steps: 25, exit_codes: { '0': 25 }, current: null, e2e: '48/48', e2e_summary: '2 failed', done: true },
  })
  expect(transitions(running, after)).toEqual([
    '0006-W1: your turn — G3: merge',
    '0006-W1: Codex implement-1 finished',
    '0006-W1: Review finished',
    '0006-W1: browser tests failing — 2 failed',
  ])
  expect(transitions(after, after)).toEqual([])
  expect(transitions(running, { ...after, id: '0007-W1' })).toEqual([])
})

test('reads only a non-zero failure count as failing', () => {
  expect(e2eFailed('48 passed (5.2m)')).toBe(false)
  expect(e2eFailed('0 failed')).toBe(false)
  expect(e2eFailed('2 failed')).toBe(true)
})

test('keeps the last good snapshot when collection fails', () => {
  const kept = afterFailure(snap({ collected_at: '14:35:02' }), 'The collector exited 1.')
  expect(kept.ok).toBe(true)
  expect(kept.stale).toBe('The collector exited 1.')
  expect(afterFailure({ ok: false }, 'The collector exited 1.')).toEqual({ ok: false, message: 'The collector exited 1.' })
})

test('reports collector output that is not JSON', () => {
  expect(parseSnapshot('not json').ok).toBe(false)
})

test('runs a Python collector with python3 and anything else directly', () => {
  expect(collectorArgv('/x/collect.py')).toEqual(['python3', '-I', '/x/collect.py'])
  expect(collectorArgv('/x/collect')).toEqual(['/x/collect'])
})

test('treats an empty collector as not configured', () => {
  expect(collectorArgv('  ')).toBeUndefined()
})

test('prefers the project file over the user-level option, and says which one it took', () => {
  expect(chooseCollector('{"collector": "tools/collect.py"}', '/global/collect.py')).toEqual({ collector: 'tools/collect.py', source: 'project' })
  expect(chooseCollector(undefined, '/global/collect.py')).toEqual({ collector: '/global/collect.py', source: 'user' })
  expect(chooseCollector('not json', '')).toEqual({ collector: '', source: 'none' })
  expect(chooseCollector('{"collector": "  "}', '')).toEqual({ collector: '', source: 'none' })
})

test('fingerprints the command and the program file, so any change shows', async () => {
  const argv = ['python3', '-I', 'tools/collect.py']
  const one = await fingerprint(argv, btoa('print(1)'))
  expect(one).toMatch(/^[0-9a-f]{64}$/)
  expect(await fingerprint(argv, btoa('print(1)'))).toBe(one)
  expect(await fingerprint(argv, btoa('print(2)'))).not.toBe(one)
  expect(await fingerprint(['python3', '-I', 'tools/other.py'], btoa('print(1)'))).not.toBe(one)
  expect(await fingerprint(argv, null)).not.toBe(one)
})

test('names the program a command runs', () => {
  expect(programOf(['python3', '-I', 'tools/collect.py'])).toBe('tools/collect.py')
  expect(programOf(['./collect'])).toBe('./collect')
})

test('lets only the person approve', () => {
  expect(personal('composer')).toBe(true)
  expect(personal('bridge')).toBe(true)
  expect(personal('sdk')).toBe(true)
  for (const kind of ['plugin', 'peer', 'scheduled-trigger', 'task-notification', 'channel', 'coordinator']) expect(personal(kind)).toBe(false)
})

test('asks again, saying so, when an approved collector changed', () => {
  expect(needsApproval(['./collect'], false).approval).toEqual({ command: './collect', program: './collect', file: '.claude/nextphase-pipeline-view.json' })
  expect(needsApproval(['./collect'], true).message).toContain('has changed since you approved it')
})

test('reads the implementer under its neutral name, else the older codex', () => {
  const run = codex({ name: 'Builder' })
  expect(implementerOf(snap({ implementer: run, codex: codex() }))?.name).toBe('Builder')
  expect(implementerOf(snap({ codex: run }))?.name).toBe('Builder')
  expect(implementerOf(snap({}))).toBeUndefined()
})
