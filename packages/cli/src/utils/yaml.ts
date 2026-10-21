import { loadAll } from 'js-yaml'

/**
 * Parses a single-document YAML string. Empty or comment-only content yields
 * `undefined` (js-yaml 4's `load` behaviour; v5 throws on it), and a
 * multi-document stream still throws.
 */
export function loadYaml(content: string): unknown {
  const docs = loadAll(content)
  if (docs.length > 1) {
    throw new Error('expected a single YAML document, but found more')
  }
  return docs[0]
}
