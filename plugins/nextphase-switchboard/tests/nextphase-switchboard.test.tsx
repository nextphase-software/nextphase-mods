import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'nextphase-switchboard',
  component: 'Pane',
  requestId: 'nextphase-switchboard',
  props: {
    title: 'NextPhase Switchboard',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const LIST = JSON.stringify([
  { id: 'helper-desk@benai-mods', enabled: true, installPath: '/p/helper-desk' },
  { id: 'diagram-design@diagram-design', enabled: false, installPath: '/p/diagram-design' },
])

test('the pane lists mods and plugins, and a toggle disables then reloads', async ($, on) => {
  const ran: string[][] = []
  const commands: string[] = []
  on('command.register', () => ({ value: { command: 'switchboard' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    if (e.argv.includes('list')) return { value: { exitCode: 0, stdout: LIST, stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('fs.read', (_, e) => ({
    value: e.path.startsWith('/p/helper-desk') ? '{ "modules": ["./register.tsx"] }' : '{}',
  }))
  on('command.run', (_, e) => {
    commands.push(e.command)
    return { text: 'ok' }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'nextphase-switchboard' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /BENAI-MODS/ }))?.text).toContain('BENAI-MODS · 1/1')
  expect((await ui.find({ type: 'Text', text: /DIAGRAM-DESIGN/ }))?.text).toContain('DIAGRAM-DESIGN · 0/1')
  expect((await ui.find({ type: 'Text', text: /1 of 2 on/ }))?.text).toContain('1 of 2 on')

  await ui.press({ key: 'toggle-helper-desk@benai-mods' })
  let done = false
  for (let i = 0; i < 50 && !done; i++) {
    done = !!(await ui.find({ type: 'Text', text: /helper-desk is off/ }))
  }
  expect(done).toBe(true)
  expect(ran.some(a => a.join(' ') === 'claude plugin disable helper-desk@benai-mods')).toBe(true)
  expect(commands).toContain('reload-plugins')
  await ui.unmount()
})
