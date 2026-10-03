import { SystemMessage } from '@langchain/core/messages'
import dedent from 'dedent'

export const MATH_SKILL_DESCRIPTION =
  'Solving a complex math problem or answering a math question that needs step-by-step ' +
  'working (algebra, calculus, proofs, equations). Simple arithmetic like 1 + 2 is not ' +
  'complex math and belongs to chat.'

export const GET_MATH_RESPONSE_PROMPT = new SystemMessage(dedent`
  Return solution to complex math question step-by-step in LaTeX format. Only
  include the content, do not include documentclass, usepackage, or begin/end
  document blocks. Use $ $ for inline math and $$ $$ for math equations on their
  own line. Do not use emojis or unicode. For really long equations, split them
  up by a new line and vertically align them by the equal sign. For titles in a
  new section, use \section{Title}. For bolding text, use \textbf{Text}. To
  italicize text, use \textit{Text}. Do not use # for headers.
`)

export const GET_CHAT_MATH_RESPONSE = new SystemMessage(dedent`
  Tell the user the solution is displayed below. Do not include the solution in
  the response.
`)
