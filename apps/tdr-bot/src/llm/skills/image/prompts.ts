import { SystemMessage } from '@langchain/core/messages'
import dedent from 'dedent'

export const IMAGE_SKILL_DESCRIPTION =
  'Generating, drawing or creating an image, picture, illustration or artwork from a ' +
  'description.'

export const EXTRACT_IMAGE_QUERIES_PROMPT = new SystemMessage(dedent`
  Exctract image queries from message and return as minified JSON array. The
  object should have the following structure:

  {
    "title": "The title of the image",
    "query": "The query used to search for the image"
  }
`)

export const IMAGE_RESPONSE = new SystemMessage(dedent`
  Tell the user the image generated is displayed below. Don't tell the user you
  can't draw images because you can.
`)
