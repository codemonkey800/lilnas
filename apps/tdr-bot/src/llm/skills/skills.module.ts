import { Module } from '@nestjs/common'

import { RequestHandlingModule } from 'src/media-operations/request-handling/request-handling.module'
import { RemindersModule } from 'src/reminders/reminders.module'
import { ServicesModule } from 'src/services/services.module'

import { ChatSkill } from './chat/skill'
import { MathSkill } from './math/skill'
import { MediaSkill } from './media.skill'
import { ReminderSkill } from './reminder.skill'
import { Skill, SKILLS } from './skill.interface'
import { SkillRegistry } from './skill.registry'

const SKILL_CLASSES = [ChatSkill, MathSkill, MediaSkill, ReminderSkill]

/** Registers every skill under {@link SKILLS} and exposes the registry. */
@Module({
  imports: [RequestHandlingModule, RemindersModule, ServicesModule],
  providers: [
    ...SKILL_CLASSES,
    {
      provide: SKILLS,
      useFactory: (...skills: Skill[]) => skills,
      inject: SKILL_CLASSES,
    },
    SkillRegistry,
  ],
  exports: [SkillRegistry],
})
export class SkillsModule {}
