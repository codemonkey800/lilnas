import { Injectable } from '@nestjs/common'

import {
  Skill,
  SkillContext,
  SkillInput,
  SkillOutput,
} from 'src/llm/skills/skill.interface'
import { getTools } from 'src/messages/llm/tools'
import { EquationImageService } from 'src/services/equation-image.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

import {
  GET_CHAT_MATH_RESPONSE,
  GET_MATH_RESPONSE_PROMPT,
  MATH_SKILL_DESCRIPTION,
} from './prompts'

@Injectable()
export class MathSkill implements Skill {
  readonly id = 'math'
  readonly description = MATH_SKILL_DESCRIPTION

  constructor(private readonly equationImage: EquationImageService) {}

  async run(
    { message, history }: SkillInput,
    { llm, logger }: SkillContext,
  ): Promise<SkillOutput> {
    logger.log({ message: message.content }, 'Get complex math solution')

    const { output: latex } = await llm.call({
      operation: 'math.latex',
      role: 'reasoning',
      messages: [
        ...history.filter(m => m.id !== TDR_SYSTEM_PROMPT_ID),
        message,
        GET_MATH_RESPONSE_PROMPT,
      ],
      overrides: { timeoutMs: 30000 },
    })

    logger.log(
      { latexLength: latex.length, latexPreview: latex.substring(0, 200) },
      'Extracted LaTeX for rendering',
    )

    const startTime = Date.now()
    const [equationImageResponse, { message: chatResponse }] =
      await Promise.all([
        this.equationImage.getImage(latex),
        llm.call({
          operation: 'math.respond',
          role: 'chat',
          messages: [...history, message, GET_CHAT_MATH_RESPONSE],
          tools: getTools(),
          overrides: { timeoutMs: 30000 },
        }),
      ])

    logger.log(
      {
        duration: Date.now() - startTime,
        hasEquationImage: !!equationImageResponse,
        equationUrl: equationImageResponse?.url,
      },
      'Completed parallel math response operations',
    )

    return {
      messages: [message, chatResponse],
      images: equationImageResponse
        ? [
            {
              title: 'the solution',
              url: equationImageResponse.url,
              parentId: chatResponse.id,
            },
          ]
        : [],
    }
  }
}
