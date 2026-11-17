import type { IconName } from '@lilnas/ui'
import { Icon } from '@lilnas/ui'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * What an `@lilnas/ui` `Icon` draws inside its `<svg>`, normalised through the
 * DOM so it compares equal to a `svg.innerHTML` read back off a rendered tree.
 * `Icon` is inline SVG with no name attribute, so "this renders the film icon"
 * is asserted by comparing bodies.
 */
export function iconBody(name: IconName): string {
  const probe = document.createElement('div')

  probe.innerHTML = renderToStaticMarkup(createElement(Icon, { name }))

  return probe.querySelector('svg')?.innerHTML ?? ''
}
