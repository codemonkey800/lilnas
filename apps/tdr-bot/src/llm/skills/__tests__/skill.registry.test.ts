import { Skill } from 'src/llm/skills/skill.interface'
import { SkillRegistry } from 'src/llm/skills/skill.registry'

const skill = (id: string): Skill => ({
  id,
  description: id,
  run: async () => ({ messages: [] }),
})

describe('SkillRegistry', () => {
  it('lists ids, skills and looks them up by id', () => {
    const a = skill('a')
    const b = skill('b')
    const registry = new SkillRegistry([a, b])

    expect(registry.ids()).toEqual(['a', 'b'])
    expect(registry.all()).toEqual([a, b])
    expect(registry.get('b')).toBe(b)
  })

  it('throws for unknown and duplicate ids', () => {
    expect(() => new SkillRegistry([]).get('x')).toThrow(/Unknown skill/)
    expect(() => new SkillRegistry([skill('a'), skill('a')])).toThrow(
      /Duplicate/,
    )
  })
})
