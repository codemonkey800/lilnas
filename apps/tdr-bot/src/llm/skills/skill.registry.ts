import { Inject, Injectable } from '@nestjs/common'

import { Skill, SKILLS } from './skill.interface'

@Injectable()
export class SkillRegistry {
  private readonly byId = new Map<string, Skill>()

  constructor(@Inject(SKILLS) skills: Skill[]) {
    for (const skill of skills) {
      if (this.byId.has(skill.id)) {
        throw new Error(`Duplicate skill id '${skill.id}'`)
      }
      this.byId.set(skill.id, skill)
    }
  }

  ids(): string[] {
    return [...this.byId.keys()]
  }

  get(id: string): Skill {
    const skill = this.byId.get(id)
    if (!skill) throw new Error(`Unknown skill '${id}'`)
    return skill
  }

  all(): Skill[] {
    return [...this.byId.values()]
  }
}
