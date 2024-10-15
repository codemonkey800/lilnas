import { useAtom, useAtomValue } from 'jotai'
import { activeVideoAtom, filesAtom } from 'src/state'
import { cns } from 'src/utils/cns'

export function VideoPicker() {
  const files = useAtomValue(filesAtom)
  const [activeVideo, setActiveVideo] = useAtom(activeVideoAtom)

  return (
    <ul
      className={cns(
        'flex flex-col gap-2 bg-gray-700',
        'min-w-[220px] w-[220px]',
        'overflow-scroll max-h-screen',
      )}
    >
      {files
        .filter(file => file.name.includes('_A'))
        .sort((file1, file2) => file2.name.localeCompare(file1.name))
        .map(file => file.name.replace(/_[NE]_A.MP4/, ''))
        .map(file => (
          <li
            className={cns(
              'text-white font-medium p-2',
              activeVideo && file.includes(activeVideo)
                ? 'bg-gray-800 hover:bg-gray-900'
                : 'hover:bg-gray-800',
            )}
          >
            <button onClick={() => setActiveVideo(file)} type="button">
              {file}
            </button>
          </li>
        ))}
    </ul>
  )
}
