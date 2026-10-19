import { expect, mock, test } from 'claude-code/testing'

// Draws the band, the card and the pane on each surface after one counted task.
// The engine refuses a tree its surface cannot draw, so a mount that resolves is a layout that shows.

const PLUGIN = 'nextphase-task-tokens'
const bandProps = (bodyColumns: number, isWorking = false) =>
  ({ hasSurvey: false, isWorking, maxRows: 20, bodyColumns, scroll: { offset: 0, bodyRows: 19 }, view: {} }) as any
const paneProps = (bodyColumns: number) =>
  ({ title: 'Task tokens', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }) as any

const step = (input: number, output: number, read: number, write: number, model: string) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  model,
})

/** One task of two main calls, one subagent call and three tool calls, as the engine would raise it. */
const runTask = async ($: any, on: any, helper = 'claude-sonnet-5-5') => {
  mock.store(on)
  mock.clock(on, { now: 1_800_000_000_000 })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  // What is beneath this mod: another mod's band, which must stay.
  on('ui.render', ($$: any, e: any) => $$.ui.resolve(e).Text({ children: ['other band'] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let context = 796_900
  on('session.usage', () => ({
    value: {
      startedAt: 1_799_999_000_000,
      context: { tokens: context, window: 1_000_000, percent: 80 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: context === 796_900 ? 15 : 16, resetsAt: '2027-01-15T10:10:00.000Z' },
        { kind: 'seven_day', percentUsed: 11 },
      ],
    },
  }))
  const usages = [
    step(1500, 900, 782_000, 21_400, 'claude-opus-5-5'),
    step(200, 300, 40_000, 5000, helper),
    step(1600, 1000, 812_200, 0, 'claude-opus-5-5'),
  ]
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usages[e.index] }
  })
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { stdout: 'x'.repeat(8400), stderr: '', interrupted: false } }))

  await $.session.start({ cwd: '/work' })
  await $.turn.start({ text: 'do the thing', turnId: 't1' })
  const call = { turnId: 't1', model: 'claude-opus-5-5', messageCount: 3 }
  for await (const _ of $.turn.step({ ...call, index: 0 })) void _
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'Bash', command: 'git diff' })
  for await (const _ of $.turn.step({ ...call, index: 1, agentId: 'agent-a', model: helper })) void _
  for await (const _ of $.turn.step({ ...call, index: 2 })) void _
  context = 799_800
  await $.turn.complete({ answer: 'done', durationMs: 14_000, isAborted: false, turnId: 't1', reason: 'answer' })
}

/** Every piece of text a drawing holds, in order, the pieces of one Text joined as the surface shows them. */
const flatten = (node: any): string =>
  node === null || node === undefined || typeof node === 'boolean'
    ? ''
    : typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : Array.isArray(node)
        ? node.map(flatten).join('')
        : `${node.props?.label ?? ''}${flatten(node.children)}${node.type === 'Text' ? '' : '\n'}`

const textOf = async (ui: any): Promise<string> => flatten(await ui.drawn())

for (const surface of ['desktop', 'terminal'] as const) {
  test(`the band, the card and the pane draw on ${surface} after a task`, async ($, on) => {
    await runTask($, on)

    const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(100) })
    const collapsed = await textOf(band)
    expect(collapsed).toContain('other band')
    expect(collapsed).toContain('32k new tokens')
    expect(collapsed).not.toContain('1.67M')
    expect(collapsed).toContain('5h 16% · week 11% · 3 calls · 1 subagent · 14s · context 80%')
    expect(collapsed).not.toContain('Fable')
    expect(await band.find({ key: 'tokens-expand' })).toBeDefined()

    await band.press({ key: 'tokens-expand' })
    const card = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(100) })
    const expanded = await textOf(card)
    for (const words of [
      'Opus 5.5 · 14s · 3 calls',
      '32k new tokens this task',
      '● Output 2,200',
      '● Added to context 26,400',
      '● Uncached input 3,300',
      '● Re-read from cache 1.63M',
      '· ~545k per call',
      '1 subagent · 46k tokens, 2.7% of the task',
      '2 tool calls · Bash ×2 (~4,2',
    ]) {
      expect(expanded).toContain(words)
    }
    // The exact total is the pane's; the card leads with what the task added.
    expect(expanded).not.toContain('1,666,100')
    expect(expanded).toContain('80% full')
    expect(expanded).toContain('800k of 1.00M · +2,900 this task')
    expect(expanded).toContain('16% used')
    expect(expanded).toContain('+1% this task · resets in 2h 10m')
    expect(expanded).toContain('11% used')
    expect(expanded).toContain('<1% this task')
    expect(expanded).toContain('Models: Opus 5.5 97.3% · Sonnet 5.5 2.7%')
    expect(await card.find({ key: 'tokens-collapse' })).toBeDefined()

    const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: paneProps(60) })
    const shown = await textOf(pane)
    for (const words of [
      'SESSION',
      '32k new tokens over 1 task',
      're-read from cache 1.63M · 1,666,100 in all',
      '1,666,100 in all · largest call 815k',
      'Subagent: Sonnet 5.5 · 1 call · 45,500',
      'Tool: Bash ×2',
    ]) {
      expect(shown).toContain(words)
    }

    await card.press({ key: 'tokens-collapse' })
    const hidden = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(100) })
    await hidden.press({ key: 'tokens-hide' })
    const gone = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(100) })
    expect(await textOf(gone)).not.toContain('tokens')
    expect(await textOf(gone)).toContain('other band')
  })
}

test('the band, the card and the pane mark a task a Fable subagent worked on', async ($, on) => {
  await runTask($, on, 'claude-fable-5-1')

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: bandProps(100) })
  expect(await textOf(band)).toContain('✦ Fable 5.1 (subagent)')

  await band.press({ key: 'tokens-expand' })
  const card = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: bandProps(100) })
  const expanded = await textOf(card)
  expect(expanded).toContain('✦ Fable 5.1 (subagent)')
  expect(expanded).toContain('Models: Opus 5.5 97.3% · Fable 5.1 2.7%')

  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PLUGIN, props: paneProps(60) })
  expect(await textOf(pane)).toContain('Subagent: Fable 5.1 · 1 call · 45,500')
})
