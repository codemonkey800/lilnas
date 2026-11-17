import { act, render, screen } from '@testing-library/react'

import { FakeEventSource } from 'src/app/__tests__/helpers/fake-event-source'
import { operation } from 'src/app/__tests__/helpers/fixtures'
import { OperationLog } from 'src/components/logs/OperationLog'
import { OP_RECONNECT_MS } from 'src/components/logs/use-operation-stream'

const line = (text: string) => ({
  type: 'line',
  line: { stream: 'stderr', text, ts: new Date().toISOString() },
})

beforeEach(() => {
  FakeEventSource.reset()
  global.EventSource = FakeEventSource as unknown as typeof EventSource
})

describe('OperationLog', () => {
  it('opens the operation’s stream and prints its command and lines', () => {
    render(
      <OperationLog operation={operation({ id: 'op-7', actor: 'Jeremy' })} />,
    )

    const stream = FakeEventSource.latest('/api/operations/op-7/stream')
    act(() => {
      stream.emit(line('Container blabla-web-1  Starting'))
      stream.emit(line('Container blabla-web-1  Started'))
    })

    // The command sits above the well; the lines are in it.
    expect(screen.getByText('$ docker compose up -d')).toBeInTheDocument()
    const log = screen.getByRole('log')
    expect(log).toHaveTextContent('Container blabla-web-1 Starting')
    expect(log).toHaveTextContent('Container blabla-web-1 Started')
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByText(/Jeremy/)).toBeInTheDocument()
  })

  it('shows the final exit line when the stream reports done', () => {
    const running = operation({ id: 'op-7' })
    render(<OperationLog operation={running} />)
    const stream = FakeEventSource.latest('/operations/op-7/stream')

    act(() => {
      stream.emit(line('Container blabla-web-1  Started'))
      stream.emit({
        type: 'done',
        operation: {
          ...running,
          status: 'succeeded',
          exitCode: 0,
          finishedAt: new Date(
            Date.parse(running.startedAt) + 4100,
          ).toISOString(),
        },
      })
    })

    expect(screen.getByText('exit 0 · 4.1s')).toHaveClass('text-ok')
    expect(screen.getByText('Exit 0')).toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(stream.close).toHaveBeenCalled()
  })

  it('marks a failed operation and does not reconnect after done', () => {
    jest.useFakeTimers()
    try {
      const running = operation({ id: 'op-8' })
      render(<OperationLog operation={running} />)
      const stream = FakeEventSource.latest('/operations/op-8/stream')

      act(() => {
        stream.emit({
          type: 'done',
          operation: { ...running, status: 'failed', exitCode: 1 },
        })
        // The server ends the stream after `done`; EventSource reports that.
        stream.fail()
      })
      act(() => {
        jest.advanceTimersByTime(OP_RECONNECT_MS * 2)
      })

      expect(screen.getByText('exit 1')).toHaveClass('text-bad')
      expect(screen.getByText('Exit 1')).toBeInTheDocument()
      expect(FakeEventSource.matching('/operations/op-8/stream')).toHaveLength(
        1,
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('starts over instead of duplicating lines when the stream drops', () => {
    jest.useFakeTimers()
    try {
      render(<OperationLog operation={operation({ id: 'op-9' })} />)
      const first = FakeEventSource.latest('/operations/op-9/stream')
      act(() => first.emit(line('one')))

      act(() => first.fail())
      act(() => {
        jest.advanceTimersByTime(OP_RECONNECT_MS)
      })

      const second = FakeEventSource.latest('/operations/op-9/stream')
      expect(second).not.toBe(first)
      // The server replays everything so far on a new connection.
      act(() => {
        second.emit(line('one'))
        second.emit(line('two'))
      })

      const rows = screen.getAllByText(/^(one|two)$/)
      expect(rows.map(r => r.textContent)).toEqual(['one', 'two'])
    } finally {
      jest.useRealTimers()
    }
  })

  it('closes its stream when it unmounts', () => {
    const { unmount } = render(
      <OperationLog operation={operation({ id: 'op-1' })} />,
    )
    const stream = FakeEventSource.latest('/operations/op-1/stream')
    unmount()
    expect(stream.close).toHaveBeenCalled()
  })
})
