import { match } from 'ts-pattern'
import { useAtomValue } from 'jotai'

import { AppState, appStateAtom } from 'src/state'

import { FilePicker } from './FilePicker'
import { VideoPlayer } from './VideoPlayer'

export function App() {
  const appState = useAtomValue(appStateAtom)

  return (
    <div className="flex flex-auto flex-col">
      {match(appState)
        .with(AppState.FilePicker, () => <FilePicker />)
        .with(AppState.VideoPlayer, () => <VideoPlayer />)
        .otherwise(() => null)}
    </div>
  )
}
