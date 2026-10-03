export type RouterSkill = 'chat' | 'math' | 'image' | 'media' | 'reminder'

export interface RouterCase {
  input: string
  expected: RouterSkill
  note?: string
}

export const ROUTER_SKILLS: readonly RouterSkill[] = [
  'chat',
  'math',
  'image',
  'media',
  'reminder',
]

export const ROUTER_CASES: readonly RouterCase[] = [
  // chat
  { input: 'hey what is up', expected: 'chat' },
  { input: 'tell me a joke about penguins', expected: 'chat' },
  {
    input: 'who won the world cup last year?',
    expected: 'chat',
    note: 'needs web search, still the chat skill',
  },
  {
    input: 'what is the weather like in Tokyo right now',
    expected: 'chat',
    note: 'needs web search',
  },
  {
    input: 'explain how a transformer neural network works',
    expected: 'chat',
  },
  {
    input: 'what is 1 + 2',
    expected: 'chat',
    note: 'simple arithmetic is not complex math',
  },
  {
    input: 'generate a list of movies that came out in 1994',
    expected: 'chat',
    note: 'adversarial: general knowledge list; no download/library/status action requested, so chat rather than media',
  },
  {
    input: 'the image you sent earlier was pretty funny lol',
    expected: 'chat',
    note: 'adversarial: "image" used as a noun, not a request',
  },
  {
    input: 'what is the best image format for photos, png or jpeg?',
    expected: 'chat',
    note: 'adversarial: "image" as a noun in a question',
  },
  {
    input: 'thanks, that was helpful',
    expected: 'chat',
  },

  // math
  { input: 'solve x^2 = 4', expected: 'math' },
  { input: "what's the integral of sin(x) * cos(x) dx?", expected: 'math' },
  { input: 'find the derivative of x^3 * ln(x)', expected: 'math' },
  {
    input: 'solve the system 2x + y = 5 and x - y = 1',
    expected: 'math',
  },
  { input: 'what is the determinant of [[1,2],[3,4]]?', expected: 'math' },
  {
    input: 'prove that the square root of 2 is irrational',
    expected: 'math',
  },
  {
    input: 'compute the limit of (sin x)/x as x approaches 0',
    expected: 'math',
  },
  {
    input:
      'what are the eigenvalues of a 3x3 matrix with rows 2 0 0, 0 3 4, 0 4 9',
    expected: 'math',
  },

  // image
  { input: 'draw me a cat wearing a top hat', expected: 'image' },
  { input: 'generate a picture of a sunset over the ocean', expected: 'image' },
  { input: 'make an image of a cyberpunk city at night', expected: 'image' },
  { input: 'can you create a logo for my discord server?', expected: 'image' },
  { input: 'paint a watercolor of a mountain cabin', expected: 'image' },
  { input: 'show me a picture of a golden retriever puppy', expected: 'image' },
  {
    input: 'generate an image of a dragon, then make it more cartoonish',
    expected: 'image',
  },

  // media
  { input: 'download the movie Inception', expected: 'media' },
  { input: 'do I have Dune in 4k?', expected: 'media' },
  { input: 'delete the show Breaking Bad', expected: 'media' },
  { input: "what's downloading right now?", expected: 'media' },
  { input: 'any good sci-fi films I can add?', expected: 'media' },
  { input: 'add season 2 of Severance', expected: 'media' },
  { input: 'jeremy plus, grab me The Matrix', expected: 'media' },
  { input: 'is Arcane in the library?', expected: 'media' },
  { input: 'remove the movie Cats from the server', expected: 'media' },
  { input: 'Jeremy+ what is the status of my downloads', expected: 'media' },

  // reminder
  { input: 'remind me to take out the trash at 6pm', expected: 'reminder' },
  { input: 'show my reminders', expected: 'reminder' },
  { input: 'cancel my reminder about the dentist', expected: 'reminder' },
  {
    input: 'remind me every Monday at 9am to submit my timesheet',
    expected: 'reminder',
    note: 'recurring',
  },
  {
    input: 'remind @sam to feed the cat tomorrow at 8am',
    expected: 'reminder',
    note: 'for another user',
  },
  {
    input: 'remind everyone in #general about the meeting on Friday at noon',
    expected: 'reminder',
    note: 'delivered in a channel',
  },
  {
    input: 'remind me what 2+2 is',
    expected: 'reminder',
    note: 'adversarial: contains math but is a request to be reminded',
  },
  {
    input: 'what reminders do I have set?',
    expected: 'reminder',
  },
  {
    input: 'delete all of my reminders',
    expected: 'reminder',
  },
  {
    input: 'remind me in 30 minutes to check the oven',
    expected: 'reminder',
  },
]
