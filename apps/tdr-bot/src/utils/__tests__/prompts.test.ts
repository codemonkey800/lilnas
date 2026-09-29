import {
  EXTRACT_SEARCH_QUERY_PROMPT,
  GET_MEDIA_TYPE_PROMPT,
} from 'src/utils/prompts'

/** Genre, actor and decade examples that taught the model non-title searches. */
const NON_TITLE_EXAMPLES = [
  'horror 90s',
  'Ryan Gosling',
  'Leonardo DiCaprio',
  'cooking MasterChef',
  'sci-fi',
  'Marvel',
]

describe('GET_MEDIA_TYPE_PROMPT', () => {
  const prompt = String(GET_MEDIA_TYPE_PROMPT.content)

  it('searches by title and asks for one on genre or actor requests', () => {
    expect(prompt).toContain('Searches are by title (and year)')
    expect(prompt).toContain(
      'If the user asks by genre, actor, director or decade instead of a title, use an empty string',
    )
  })

  it.each(NON_TITLE_EXAMPLES)('has no "%s" example', example => {
    expect(prompt).not.toContain(example)
  })

  it('lists delete as a search intent in the JSON shape', () => {
    expect(prompt).toContain(
      '"searchIntent": "library" | "external" | "both" | "delete"',
    )
  })
})

describe('EXTRACT_SEARCH_QUERY_PROMPT', () => {
  const prompt = String(EXTRACT_SEARCH_QUERY_PROMPT.content)

  it('searches by title and returns nothing for genre or actor requests', () => {
    expect(prompt).toContain('Searches are by title (and year)')
    expect(prompt).toContain(
      'If the user asks by genre, actor, director or decade instead of a title, return an empty response',
    )
  })

  it.each(NON_TITLE_EXAMPLES)('has no "%s" example', example => {
    expect(prompt).not.toContain(example)
  })
})
