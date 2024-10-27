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
          const dirs = [await window.showDirectoryPicker()]
          const files: FileSystemFileHandle[] = []

          while (dirs.length > 0) {
            const dir = dirs.pop()

            if (!dir) {
              continue
            }

            for await (const [, file] of dir.entries()) {
              if (file.name.startsWith('.')) {
                continue
              }

              if (file.kind === 'file') {
                if (file.name.includes('.MP4')) {
                  files.push(file)
                }
              } else {
                dirs.push(file)
              }
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
