export type SwitchItem = {
  id: string
  name: string
  source: string
  enabled: boolean
  kind: 'mod' | 'plugin'
}

declare module 'claude-code' {
  interface PluginState {
    'nextphase-switchboard': {
      items: SwitchItem[]
      busy: string
      note: string
    }
  }
}
