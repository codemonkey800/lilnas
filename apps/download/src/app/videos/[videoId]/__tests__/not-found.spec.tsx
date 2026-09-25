import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import RootNotFound from 'src/app/not-found'
import VideoNotFound, {
  VIDEO_NOT_FOUND_DESCRIPTION,
  VIDEO_NOT_FOUND_TITLE,
} from 'src/app/videos/[videoId]/not-found'
import { LIBRARY_HREF } from 'src/components/detail/library-link'
import {
  NOT_FOUND_BACK_LABEL,
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_TITLE,
} from 'src/components/shell/not-found'

/** The rendered class list, which is the only place `cns` output is real. */
function classesOf(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('VideoNotFound', () => {
  it('names the video rather than the address', () => {
    render(<VideoNotFound />)

    expect(
      screen.getByRole('heading', { level: 2, name: VIDEO_NOT_FOUND_TITLE }),
    ).toBeInTheDocument()
    expect(screen.getByText(VIDEO_NOT_FOUND_DESCRIPTION)).toBeInTheDocument()
  })

  it('⚠️ earns its keep — it says what the root 404 cannot', () => {
    render(<VideoNotFound />)

    // The test for a segment-scoped boundary now that a root one exists. A
    // `tmdb:`/`tvdb:` key always resolves upstream; a video exists only
    // because somebody downloaded it, so this address means the download never
    // happened, which comes with a different next step.
    expect(VIDEO_NOT_FOUND_TITLE).not.toBe(NOT_FOUND_TITLE)
    expect(VIDEO_NOT_FOUND_DESCRIPTION).not.toBe(NOT_FOUND_DESCRIPTION)
    expect(screen.queryByText(NOT_FOUND_DESCRIPTION)).toBeNull()
  })

  it('⚠️ is visibly the same state as the root 404, not a second design', () => {
    const video = render(<VideoNotFound />)
    const root = render(<RootNotFound />)

    const panelOf = (container: HTMLElement) => {
      const panel = container.querySelector('[class*="max-w-[560px]"]')

      if (!(panel instanceof HTMLElement)) {
        throw new Error('expected the shared not-found panel')
      }

      return panel
    }

    expect(classesOf(panelOf(video.container))).toEqual(
      classesOf(panelOf(root.container)),
    )
  })

  it('still titles the document, because the panel is only an h2', () => {
    render(<VideoNotFound />)

    expect(
      screen.getByRole('heading', { level: 1, name: VIDEO_NOT_FOUND_TITLE }),
    ).toHaveClass('sr-only')
  })

  it('lands in the video route’s own column', () => {
    const { container } = render(<VideoNotFound />)

    // `VideoDetailShell`, shared with the page and its error boundary, so
    // nothing shifts as one replaces another.
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(
      container.querySelector('.mx-auto.max-w-\\[1080px\\]'),
    ).toBeInTheDocument()
  })

  it('offers exactly one way out, to the library', () => {
    render(<VideoNotFound />)
    const links = screen.getAllByRole('link')

    // The panel's own back link replaced the breadcrumb this file used to
    // render above it; two anchors to `/gallery` stacked is noise.
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', LIBRARY_HREF)
    expect(links[0]).toHaveAccessibleName(NOT_FOUND_BACK_LABEL)
  })

  it('⚠️ is not the error register — nothing here is broken', () => {
    const { container } = render(<VideoNotFound />)

    // This used to be a `Note` wearing `alert`, which is this system's error
    // register. A video that was never downloaded is not a fault.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.querySelectorAll('[class*="bad"]')).toHaveLength(0)
  })
})
