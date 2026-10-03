export interface ScenarioExpect {
  skill: string
  followUp: boolean
  images: number
  contains: string
}

export interface Scenario {
  name: string
  turns: Array<{ input: string; expect: Partial<ScenarioExpect> }>
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'reminder missing the day, then supplied',
    turns: [
      {
        input: 'remind me to call mom at 5pm',
        expect: { skill: 'reminder', followUp: true },
      },
      {
        input: 'tomorrow',
        expect: { skill: 'reminder', followUp: false, contains: 'tomorrow' },
      },
    ],
  },
  {
    name: 'reminder then topic switch',
    turns: [
      {
        input: 'remind me to water the plants',
        expect: { skill: 'reminder', followUp: true },
      },
      {
        input: 'actually never mind, who painted the Mona Lisa?',
        expect: { skill: 'chat', followUp: false, contains: 'Leonardo' },
      },
    ],
  },
  {
    name: 'media search then pick the first one',
    turns: [
      {
        input: 'find the movie Dune',
        expect: { skill: 'media', followUp: true },
      },
      {
        input: 'the first one',
        expect: { skill: 'media', followUp: false },
      },
    ],
  },
  {
    name: 'media search then unrelated question',
    turns: [
      {
        input: 'find the movie Dune',
        expect: { skill: 'media', followUp: true },
      },
      {
        input: 'what is the capital of France?',
        expect: { skill: 'chat', followUp: false, contains: 'Paris' },
      },
    ],
  },
  {
    name: 'image request returns an image',
    turns: [
      {
        input: 'draw me a cat wearing a top hat',
        expect: { skill: 'image', images: 1 },
      },
    ],
  },
]
