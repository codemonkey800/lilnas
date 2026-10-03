import {
  ROUTER_CASES,
  ROUTER_SKILLS,
} from 'src/llm/testing/golden/router-cases'
import { SCENARIOS } from 'src/llm/testing/golden/scenarios'

describe('golden router cases', () => {
  it('has at least 36 cases', () => {
    expect(ROUTER_CASES.length).toBeGreaterThanOrEqual(36)
  })

  it('has unique, non-empty inputs', () => {
    const inputs = ROUTER_CASES.map(c => c.input.trim().toLowerCase())
    expect(inputs.every(i => i.length > 0)).toBe(true)
    expect(new Set(inputs).size).toBe(inputs.length)
  })

  it.each(ROUTER_SKILLS)('has at least 6 cases for %s', skill => {
    expect(
      ROUTER_CASES.filter(c => c.expected === skill).length,
    ).toBeGreaterThanOrEqual(6)
  })

  it('only uses known skills', () => {
    for (const c of ROUTER_CASES) {
      expect(ROUTER_SKILLS).toContain(c.expected)
    }
  })
})

describe('golden scenarios', () => {
  it('has unique names', () => {
    const names = SCENARIOS.map(s => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('has at least one turn per scenario, each with an input', () => {
    for (const s of SCENARIOS) {
      expect(s.turns.length).toBeGreaterThan(0)
      for (const t of s.turns) expect(t.input.trim()).not.toBe('')
    }
  })

  it('only expects known skills', () => {
    for (const s of SCENARIOS) {
      for (const t of s.turns) {
        if (t.expect.skill) expect(ROUTER_SKILLS).toContain(t.expect.skill)
      }
    }
  })
})
