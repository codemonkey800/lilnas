import { useSetAtom } from 'jotai'

import { AppState, appStateAtom, filesAtom } from 'src/state'

import { Button } from './Button'

export function FilePicker() {
  const setFiles = useSetAtom(filesAtom)
  const setAppState = useSetAtom(appStateAtom)

  return (
    <div className="flex flex-auto flex-col gap-4 items-center justify-center">
      <h1 className="text-5xl font-bold text-white">Dashcam Viewer</h1>

      <Button
        onClick={async () => {
          const dir = await window.showDirectoryPicker()
          const files: FileSystemFileHandle[] = []

          for await (const [, file] of dir.entries()) {
            if (file.kind === 'file') {
              files.push(file)
            }
          }

          setFiles(files)
          setAppState(AppState.VideoPlayer)
        }}
      >
        Select Directory
      </Button>
    </div>
  )
}
