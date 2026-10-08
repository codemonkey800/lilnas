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
    name: 'cancel with two matches, then pick by number',
    turns: [
      {
        input: 'cancel my reminder about the dentist',
        expect: { skill: 'reminder', followUp: true },
      },
      {
        input: '2',
        expect: { skill: 'reminder', followUp: false, contains: 'Cancelled' },
      },
    ],
  },
  {
    name: 'cancel all, then yes',
    turns: [
      {
        input: 'cancel all my reminders',
        expect: { skill: 'reminder', followUp: true },
      },
      {
        input: 'yes',
        expect: {
          skill: 'reminder',
          followUp: false,
          contains: 'Cancelled 2',
        },
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
]
