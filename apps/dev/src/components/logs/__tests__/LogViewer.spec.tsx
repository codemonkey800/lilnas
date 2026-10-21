import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { FakeEventSource } from 'src/app/__tests__/helpers/fake-event-source'
import { formatLogTime } from 'src/components/detail/time'
import { LogViewer } from 'src/components/logs/LogViewer'
import {
  BUFFER_CAP,
  FLUSH_MS,
  RECONNECT_MS,
} from 'src/components/logs/use-container-logs'

const CONTAINERS = ['fitness-pwa-web-1', 'fitness-pwa-api-1']

let nextTs = 0
const line = (text: string, stream: 'stdout' | 'stderr' = 'stdout') => ({
  stream,
  text,
  ts: new Date(Date.UTC(2026, 9, 19, 16, 9, 0, nextTs++)).toISOString(),
})

/** Lets the viewer's batched flush run. */
async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, FLUSH_MS + 30))
  })
}

async function emit(stream: FakeEventSource, ...lines: unknown[]) {
  act(() => {
    stream.open()
    lines.forEach(l => stream.emit(l))
  })
  await flush()
}

const web = () => FakeEventSource.latest('fitness-pwa-web-1/logs')
const logEl = () => screen.getByRole('log')
const rows = () => logEl().querySelectorAll('[data-stream]')

/** jsdom does no layout, so give the log a scrollable box we can inspect. */
function giveBox(
  el: HTMLElement,
  box = { scrollHeight: 1000, clientHeight: 300 },
) {
  let scrollTop = 0
  Object.defineProperties(el, {
    scrollHeight: { configurable: true, get: () => box.scrollHeight },
    clientHeight: { configurable: true, get: () => box.clientHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v
      },
    },
  })
}

beforeEach(() => {
  FakeEventSource.reset()
  global.EventSource = FakeEventSource as unknown as typeof EventSource
})

describe('LogViewer', () => {
  it('opens the first container with the default tail and timestamps on', () => {
    render(<LogViewer containers={CONTAINERS} />)

    expect(web().url).toBe(
      '/api/containers/fitness-pwa-web-1/logs?tail=500&timestamps=1',
    )
    expect(screen.getByRole('combobox', { name: 'Container' })).toHaveValue(
      'fitness-pwa-web-1',
    )
    expect(screen.getByRole('radio', { name: '500' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('appends lines as they arrive and tints stderr', async () => {
    render(<LogViewer containers={CONTAINERS} />)

    await emit(web(), line('GET /health 200'))
    expect(rows()).toHaveLength(1)

    await emit(web(), line('Error: boom', 'stderr'), line('POST /x 201'))
    expect(rows()).toHaveLength(3)
    expect(screen.getByText('GET /health 200')).toBeInTheDocument()
    expect(
      screen.getByText('Error: boom').closest('[data-stream]'),
    ).toHaveClass('text-bad', 'bg-bad-ghost')
    expect(
      screen.getByText('POST /x 201').closest('[data-stream]'),
    ).not.toHaveClass('text-bad')
    expect(screen.getByText('3 lines')).toBeInTheDocument()
  })

  describe('filter', () => {
    it('hides lines that do not match, ignoring case', async () => {
      const user = userEvent.setup()
      render(<LogViewer containers={CONTAINERS} />)
      await emit(
        web(),
        line('GET /health 200'),
        line('Error: connect ETIMEDOUT'),
        line('POST /workouts 201'),
      )

      await user.type(
        screen.getByRole('textbox', { name: 'Filter lines' }),
        'timedout',
      )

      expect(rows()).toHaveLength(1)
      expect(screen.getByText('Error: connect ETIMEDOUT')).toBeInTheDocument()
      expect(screen.queryByText('GET /health 200')).not.toBeInTheDocument()
      expect(screen.getByText('1 of 3 lines')).toBeInTheDocument()
    })

    it('says so when nothing matches, and Clear filter brings the lines back', async () => {
      const user = userEvent.setup()
      render(<LogViewer containers={CONTAINERS} />)
      await emit(web(), line('GET /health 200'))

      await user.type(
        screen.getByRole('textbox', { name: 'Filter lines' }),
        'timeout',
      )

      expect(screen.getByText('No lines match “timeout”')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Clear filter' }))
      expect(screen.getByText('GET /health 200')).toBeInTheDocument()
    })
  })

  describe('follow', () => {
    it('autoscrolls to the newest line while on, and stops after a manual scroll up', async () => {
      render(<LogViewer containers={CONTAINERS} />)
      const el = logEl()
      giveBox(el)

      await emit(web(), line('a'), line('b'))
      expect(el.scrollTop).toBe(1000)

      // The reader scrolls up: 100 + 300 is far from the 1000 bottom.
      el.scrollTop = 100
      fireEvent.scroll(el)
      expect(screen.getByRole('switch', { name: 'Follow' })).toHaveAttribute(
        'aria-checked',
        'false',
      )

      await emit(web(), line('c'))
      expect(rows()).toHaveLength(3)
      expect(el.scrollTop).toBe(100)

      // Turning Follow back on jumps to the bottom again.
      fireEvent.click(screen.getByRole('switch', { name: 'Follow' }))
      expect(el.scrollTop).toBe(1000)
    })

    it('stays on when the scroll is within a few pixels of the bottom', async () => {
      render(<LogViewer containers={CONTAINERS} />)
      const el = logEl()
      giveBox(el)
      await emit(web(), line('a'))

      el.scrollTop = 690 // 1000 - 690 - 300 = 10px short
      fireEvent.scroll(el)

      expect(screen.getByRole('switch', { name: 'Follow' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    })
  })

  it('reopens the stream when Timestamps is toggled', async () => {
    const user = userEvent.setup()
    render(<LogViewer containers={CONTAINERS} />)
    const first = web()
    const a = line('a')
    await emit(first, a)
    expect(screen.getByText(formatLogTime(a.ts))).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Timestamps' }))

    expect(first.close).toHaveBeenCalled()
    expect(web().url).toBe(
      '/api/containers/fitness-pwa-web-1/logs?tail=500&timestamps=0',
    )
    expect(rows()).toHaveLength(0)
    // Without timestamps the server sends none and the viewer shows none.
    await emit(web(), { stream: 'stdout', text: 'b' })
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.queryByText(formatLogTime(a.ts))).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Timestamps' }))
    expect(web().url).toBe(
      '/api/containers/fitness-pwa-web-1/logs?tail=500&timestamps=1',
    )
  })

  it('reopens with an empty buffer for another tail or container', async () => {
    const user = userEvent.setup()
    render(<LogViewer containers={CONTAINERS} />)
    await emit(web(), line('a'))

    await user.click(screen.getByRole('radio', { name: '2000' }))
    expect(web().url).toContain('tail=2000')
    expect(rows()).toHaveLength(0)

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Container' }),
      'fitness-pwa-api-1',
    )
    expect(FakeEventSource.latest('/logs').url).toBe(
      '/api/containers/fitness-pwa-api-1/logs?tail=2000&timestamps=1',
    )
  })

  it('keeps only the last BUFFER_CAP lines', async () => {
    render(<LogViewer containers={CONTAINERS} />)
    const over = 3
    const all = Array.from({ length: BUFFER_CAP + over }, (_, i) =>
      line(`line ${i}`),
    )

    await emit(web(), ...all)

    expect(rows()).toHaveLength(BUFFER_CAP)
    expect(screen.queryByText('line 0')).not.toBeInTheDocument()
    expect(screen.queryByText(`line ${over - 1}`)).not.toBeInTheDocument()
    expect(screen.getByText(`line ${over}`)).toBeInTheDocument()
    expect(
      screen.getByText(`line ${BUFFER_CAP + over - 1}`),
    ).toBeInTheDocument()

    // Later lines push the oldest out one by one.
    await emit(web(), line('one more'))
    expect(rows()).toHaveLength(BUFFER_CAP)
    expect(screen.queryByText(`line ${over}`)).not.toBeInTheDocument()
    expect(screen.getByText('one more')).toBeInTheDocument()
  })

  it('Clear empties the buffer without reopening the stream', async () => {
    const user = userEvent.setup()
    render(<LogViewer containers={CONTAINERS} />)
    await emit(web(), line('a'), line('b'))

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(rows()).toHaveLength(0)
    expect(FakeEventSource.matching('/logs')).toHaveLength(1)
    await emit(web(), line('c'))
    expect(rows()).toHaveLength(1)
  })

  describe('download', () => {
    const created: Blob[] = []
    const downloads: string[] = []

    beforeEach(() => {
      created.length = 0
      downloads.length = 0
      URL.createObjectURL = jest.fn((blob: Blob) => {
        created.push(blob)
        return 'blob:logs'
      })
      URL.revokeObjectURL = jest.fn()
      jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          downloads.push(this.download)
        })
    })

    const textOf = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(blob)
      })

    it('saves every buffered line as <container>.log', async () => {
      const user = userEvent.setup()
      render(<LogViewer containers={CONTAINERS} />)
      const a = line('first')
      const b = line('second', 'stderr')
      await emit(web(), a, b)
      // The filter narrows the view, not the file.
      await user.type(
        screen.getByRole('textbox', { name: 'Filter lines' }),
        'first',
      )

      await user.click(screen.getByRole('button', { name: 'Download' }))

      expect(created).toHaveLength(1)
      expect(await textOf(created[0]!)).toBe(`${a.ts} first\n${b.ts} second\n`)
      expect(downloads).toEqual(['fitness-pwa-web-1.log'])
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:logs')
    })

    it('names the file after the selected container', async () => {
      const user = userEvent.setup()
      render(<LogViewer containers={CONTAINERS} />)
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Container' }),
        'fitness-pwa-api-1',
      )

      await user.click(screen.getByRole('button', { name: 'Download' }))

      expect(downloads).toEqual(['fitness-pwa-api-1.log'])
    })
  })

  describe('reconnecting', () => {
    it('shows a disconnected line, reopens, and replaces the buffer with the replayed tail', async () => {
      jest.useFakeTimers()
      try {
        render(<LogViewer containers={CONTAINERS} />)
        const first = web()
        act(() => {
          first.open()
          first.emit(line('old'))
          jest.advanceTimersByTime(FLUSH_MS)
        })
        expect(screen.getByText('old')).toBeInTheDocument()

        act(() => first.fail())
        expect(
          screen.getByText(/disconnected — reconnecting/),
        ).toBeInTheDocument()
        expect(screen.getByText('reconnecting')).toBeInTheDocument()
        expect(first.close).toHaveBeenCalled()
        // Lines stay readable while it is down.
        expect(screen.getByText('old')).toBeInTheDocument()

        act(() => {
          jest.advanceTimersByTime(RECONNECT_MS)
        })
        const second = web()
        expect(second).not.toBe(first)
        expect(second.url).toBe(first.url)

        act(() => {
          second.open()
          second.emit(line('replayed'))
          jest.advanceTimersByTime(FLUSH_MS)
        })
        expect(screen.queryByText(/disconnected/)).not.toBeInTheDocument()
        expect(screen.queryByText('old')).not.toBeInTheDocument()
        expect(screen.getByText('replayed')).toBeInTheDocument()
        expect(within(logEl()).getAllByText(/./)).toHaveLength(2) // time + text
      } finally {
        jest.useRealTimers()
      }
    })

    it('treats the end of a stopped container’s stream as final', () => {
      jest.useFakeTimers()
      try {
        render(
          <LogViewer containers={CONTAINERS} running={['fitness-pwa-api-1']} />,
        )
        const first = web()
        act(() => {
          first.open()
          first.emit(line('tail'))
          jest.advanceTimersByTime(FLUSH_MS)
        })

        // Docker closes the body once it has sent a stopped container's tail.
        act(() => first.fail())
        act(() => {
          jest.advanceTimersByTime(RECONNECT_MS * 3)
        })

        expect(FakeEventSource.matching('/logs')).toHaveLength(1)
        expect(first.close).toHaveBeenCalled()
        expect(screen.queryByText(/disconnected/)).not.toBeInTheDocument()
        expect(screen.queryByText('reconnecting')).not.toBeInTheDocument()
        expect(screen.getByText('ended')).toBeInTheDocument()
        expect(screen.getByText('tail')).toBeInTheDocument()
      } finally {
        jest.useRealTimers()
      }
    })

    it('reopens an ended stream once the container is running again', () => {
      jest.useFakeTimers()
      try {
        const { rerender } = render(
          <LogViewer containers={CONTAINERS} running={[]} />,
        )
        act(() => web().fail())
        expect(screen.getByText('ended')).toBeInTheDocument()

        rerender(
          <LogViewer containers={CONTAINERS} running={['fitness-pwa-web-1']} />,
        )

        expect(FakeEventSource.matching('/logs')).toHaveLength(2)
        expect(screen.queryByText('ended')).not.toBeInTheDocument()
      } finally {
        jest.useRealTimers()
      }
    })

    it('closes the stream and cancels a pending reconnect on unmount', () => {
      jest.useFakeTimers()
      try {
        const { unmount } = render(<LogViewer containers={CONTAINERS} />)
        const first = web()
        act(() => first.fail())

        unmount()
        act(() => {
          jest.advanceTimersByTime(RECONNECT_MS * 2)
        })

        expect(FakeEventSource.matching('/logs')).toHaveLength(1)
      } finally {
        jest.useRealTimers()
      }
    })
  })

  it('says there are no containers instead of opening a stream', () => {
    render(<LogViewer containers={[]} />)

    expect(screen.getByText('No containers yet')).toBeInTheDocument()
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('falls back to the first container when the selected one goes away', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<LogViewer containers={CONTAINERS} />)
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Container' }),
      'fitness-pwa-api-1',
    )

    rerender(<LogViewer containers={['fitness-pwa-web-1']} />)

    expect(FakeEventSource.latest('/logs').url).toContain('fitness-pwa-web-1')
  })
})
