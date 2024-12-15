import type { Root } from 'mdast'
import { visit } from 'unist-util-visit'

/**
 * Remark plugin for disabling link embeds by wrapping links in angle brackets.
 */
export function remarkFixLinkPlugin() {
  return (tree: Root) =>
    visit(tree, 'link', (node) => {
      node.url = `<${node.url}>`
    })
}
