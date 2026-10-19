import { expect, mock, test } from 'claude-code/testing'

// Draws the pane from a collector's snapshot on each surface at a narrow width.
// The engine refuses a tree its surface cannot draw, so a mount that resolves is a layout that shows.

const PLUGIN = 'nextphase-pipeline-view'
const paneProps = (bodyColumns: number) =>
  ({ title: 'Pipeline', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }) as any

const NAMES = ['Plan', 'Stage', 'Ready', 'Launch', 'Watch', 'Review', 'Fix loop', 'Merge', 'Publish', 'Close']
const GATES: Record<number, string> = { 1: 'G1', 2: 'G2', 8: 'G3', 9: 'G4' }
const snapshot = (stage: number, yourTurn: string | null) => ({
  ok: true, id: '0006-W1', title: 'Synthetic milestone', stage, stage_name: NAMES[stage - 1], in_stage: '12m 23s',
  waiting: yourTurn ? 'merge decision' : 'review in progress', your_turn: yourTurn,
  stages: NAMES.map((name, i) => {
    const n = i + 1
    const gate = GATES[n] ?? null
    return { n, name, gate, state: n < stage ? 'done' : n === stage ? 'now' : 'todo', gate_state: !gate ? null : n < stage ? 'passed' : n === stage && yourTurn ? 'waiting' : 'ahead' }
  }),
  codex: { name: 'Codex', label: 'implement-1', thread: null, model: 'model-x', effort: 'medium', running: false, failed: null, finished: true, finished_at: '14:58', elapsed: null, last_event_ago: '12m 45s', latest: 'Implemented v1. Final tip: abc1234. Worktree clean.' },
  review: { name: 'Review · macOS', steps: 19, total: 25, exit_codes: { '0': 19 }, current: 'corepack pnpm run e2e', e2e: '40/48', e2e_summary: null, done: false },
  container: 'Colima stopped',
  events: [1, 2, 3, 4, 5, 6, 7].map(i => ({ at: `14:0${i}`, text: `event ${i}` })),
  collected_at: '14:35:02',
})

const flatten = (node: any): string =>
  node === null || node === undefined || typeof node === 'boolean'
    ? ''
    : typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : Array.isArray(node)
        ? node.map(flatten).join('')
        : `${node.props?.label ?? ''}${flatten(node.children)}${node.type === 'Text' ? '' : '\n'}`

/** A session in /work whose project file names tools/collect.py; `script` is that file's text. */
const start = async ($: any, on: any, stdout: () => string, opts: { approve?: boolean; script?: () => string } = {}) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const runs: string[][] = []
  const script = opts.script ?? (() => 'print("snapshot")')
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true } }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', (_$: any, e: any) =>
    String(e.path).endsWith('tools/collect.py')
      ? { value: { base64: btoa(script()) } }
      : { value: '{"collector": "tools/collect.py"}' })
  on('process.run', (_$: any, e: any) => {
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: stdout(), stderr: '' } }
  })
  await $.session.start({ cwd: '/work' })
  if (opts.approve !== false) await $.command.run({ command: 'pipeline', args: 'allow', origin: { kind: 'composer' } })
  return { runs, clock }
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`the pane leads with nothing owed, then the strip, runs and newest log on ${surface}`, async ($, on) => {
    await start($, on, () => JSON.stringify(snapshot(6, null)))
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: paneProps(40) })
    const shown = flatten(await pane.drawn())
    for (const words of [
      'Stage 6 of 10 · Review · 12m 23s',
      'Nothing needed from you right now.',
      'Now: review in progress',
      '6/10 Review',
      'Next decision: G3 at stage 8, Merge',
      'Finished 14:58 · model-x · medium',
      '19 of 25 steps done',
      'Now: corepack pnpm run e2e',
      'Browser tests 40/48',
      'Updated 14:35:02',
    ]) {
      expect(shown).toContain(words)
    }
    expect(shown).not.toContain('Your turn')
    expect(shown).not.toContain('Final tip')
    // Newest first, five shown.
    expect(shown.indexOf('event 7')).toBeLessThan(shown.indexOf('event 3'))
    expect(shown).not.toContain('event 2')

    await pane.press({ key: 'stages' })
    const open = flatten(await pane.drawn())
    expect(open).toContain('8 Merge · G3')
    expect(open).toContain('2 Stage · G2 passed')
  })

  test(`the pane shows the owed decision on ${surface}`, async ($, on) => {
    await start($, on, () => JSON.stringify(snapshot(8, 'G3: merge after reading the verdict')))
    const shown = flatten(await (await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: paneProps(40) })).drawn())
    expect(shown).toContain('Your turn')
    expect(shown).toContain('G3: merge after reading the verdict')
    expect(shown).not.toContain('Nothing needed from you')
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`a project's collector does not run until the person approves it on ${surface}`, async ($, on) => {
    const { runs } = await start($, on, () => JSON.stringify(snapshot(6, null)), { approve: false })
    expect(runs).toHaveLength(0)
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: paneProps(40) })
    const asking = flatten(await pane.drawn())
    expect(asking).toContain("Approve this project's collector?")
    expect(asking).toContain('python3 -I tools/collect.py')
    expect(asking).toContain('Type /pipeline allow')

    // Another plugin (or a peer, or a schedule) cannot approve it.
    const refused = await $.command.run({ command: 'pipeline', args: 'allow', origin: { kind: 'plugin', name: 'other' } } as any)
    expect(refused.text).toContain('Only you can approve')
    expect(runs).toHaveLength(0)

    const allowed = await $.command.run({ command: 'pipeline', args: 'allow', origin: { kind: 'composer' } } as any)
    expect(allowed.text).toContain('Approved for this project: python3 -I tools/collect.py')
    expect(runs.length).toBeGreaterThan(0)
    expect(flatten(await pane.drawn())).toContain('Nothing needed from you right now.')
  })

  test(`a changed collector stops and asks again on ${surface}`, async ($, on) => {
    let text = 'print("snapshot")'
    const { runs, clock } = await start($, on, () => JSON.stringify(snapshot(6, null)), { script: () => text })
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: paneProps(40) })
    expect(flatten(await pane.drawn())).toContain('Nothing needed from you right now.')
    const before = runs.length
    expect(before).toBeGreaterThan(0)
    // The script changes on disk; the next collection notices before it runs anything.
    text = 'print("something else")'
    await clock.advance(10_000)
    expect(runs).toHaveLength(before)
    const asking = flatten(await pane.drawn())
    expect(asking).toContain("Approve this project's collector?")
    expect(asking).toContain('has changed since you approved it')
    // Withdrawing an approval stops it as well.
    text = 'print("snapshot")'
    await $.command.run({ command: 'pipeline', args: 'revoke', origin: { kind: 'composer' } } as any)
    await clock.advance(10_000)
    expect(runs).toHaveLength(before)
  })
}

// Exactly what examples/status-collector.py prints for examples/pipeline-status.json.
const STARTER = {"ok": true, "id": "M3", "title": "Checkout page", "stage": 2, "stage_name": "Build", "in_stage": null, "done": false, "waiting": "writing the payment form", "your_turn": null, "stages": [{"n": 1, "name": "Plan", "state": "done", "gate": null, "gate_state": null}, {"n": 2, "name": "Build", "state": "now", "gate": null, "gate_state": null}, {"n": 3, "name": "Review", "state": "todo", "gate": "Approve the review", "gate_state": "ahead"}, {"n": 4, "name": "Ship", "state": "todo", "gate": "Approve the release", "gate_state": "ahead"}], "events": [{"at": "14:05", "text": "Plan approved"}, {"at": "14:20", "text": "Build started"}], "collected_at": "14:35:02"}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`the starter collector's snapshot draws without implementer or review boxes on ${surface}`, async ($, on) => {
    await start($, on, () => JSON.stringify(STARTER))
    const shown = flatten(await (await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: paneProps(40) })).drawn())
    for (const words of [
      'M3 · Checkout page',
      'Stage 2 of 4 · Build',
      'Nothing needed from you right now.',
      'Now: writing the payment form',
      '2/4 Build',
      'Next decision: Approve the review at stage 3, Review',
      '14:20  Build started',
    ]) {
      expect(shown).toContain(words)
    }
    expect(shown).not.toContain('Implementer')
    expect(shown).not.toContain('Review run')
    expect(shown).not.toContain('steps done')
  })
}
