/**
 * Bans Tailwind utilities on a raw palette (`bg-gray-800`, `text-violet-400`)
 * and the retired `uv-*` / `ease-uv` aliases. Colour comes from the design
 * system tokens in `@lilnas/ui/theme.css` (see DESIGN.md).
 */

const UTILITIES = [
  'bg',
  'text',
  'border(?:-[xytrblse])?',
  'ring(?:-offset)?',
  'outline',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'decoration',
  'divide',
  'shadow',
].join('|')

const PALETTES = [
  'gray',
  'zinc',
  'slate',
  'neutral',
  'stone',
  'blue',
  'sky',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
].join('|')

// A class token starts at the string start or after anything that cannot be
// part of one (whitespace, a `hover:` variant colon, `!`, a quote, ...).
const START = String.raw`(?<![\w-])`

const RAW_PALETTE = new RegExp(
  `${START}(?:${UTILITIES})-(?:${PALETTES})-\\d{2,3}(?![\\w])`,
)

const RETIRED_ALIAS = new RegExp(
  `${START}(?:(?:${UTILITIES})-uv(?:-[a-z]+)?|ease-uv|--color-uv(?:-[a-z]+)?|--ease-uv)(?![\\w-])`,
)

const MESSAGE =
  'Use a design-system token instead of "{{match}}" (e.g. bg-surface, text-ink-2, border-line, text-accent-hi). ' +
  'Raw palette utilities and the uv-*/ease-uv aliases are retired; see DESIGN.md.'

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw Tailwind palette utilities and the retired uv-* aliases',
    },
    schema: [],
    messages: { raw: MESSAGE },
  },

  create(context) {
    function check(node, text) {
      const match = RAW_PALETTE.exec(text) ?? RETIRED_ALIAS.exec(text)
      if (match) {
        context.report({ node, messageId: 'raw', data: { match: match[0] } })
      }
    }

    return {
      // Plain strings, including JSX `className="..."` attribute values.
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },

      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw)
      },
    }
  },
}
