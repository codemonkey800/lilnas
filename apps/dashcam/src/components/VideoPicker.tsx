import { cns } from '@lilnas/utils/cns'
import dayjs from 'dayjs'
import { useAtom, useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { activeVideoAtom, filesAtom } from 'src/state'
import { getVideoDate } from 'src/utils/date'

const FILE_BY_MONTH_KEY = 'MMMM DD YYYY'

export function VideoPicker() {
  const files = useAtomValue(filesAtom)
  const [activeVideo, setActiveVideo] = useAtom(activeVideoAtom)

  const filesByDay = useMemo(() => {
    const groups = new Map<string, FileSystemHandle[]>()

    for (const file of files.filter(file => file.name.includes('_A'))) {
      const date = getVideoDate(file.name)
      const key = date.format(FILE_BY_MONTH_KEY)
      const groupFiles = groups.get(key) ?? []

      groupFiles.push(file)
      groups.set(key, groupFiles)
    }

    return new Map(
      Array.from(groups.entries()).map(([key, values]) => [
        key,
        values.sort((a, b) => {
          const dateA = getVideoDate(a.name)
          const dateB = getVideoDate(b.name)

          return dateB.toDate().getTime() - dateA.toDate().getTime()
        }),
      ]),
    )
  }, [files])

  const groupKeys = Array.from(filesByDay.keys()).sort((a, b) => {
    const dateA = dayjs(a, FILE_BY_MONTH_KEY)
    const dateB = dayjs(b, FILE_BY_MONTH_KEY)

    return dateB.toDate().getTime() - dateA.toDate().getTime()
  })

  return (
    <div
      className={cns(
        'flex flex-col gap-2 bg-gray-700',
        'min-w-[220px] w-[220px]',
        'overflow-scroll max-h-screen',
      )}
    >
      {groupKeys.map(groupKey => (
        <div key={groupKey}>
          <h2 className="text-white font-bold p-2">{groupKey}</h2>

          <ul className="flex flex-col gap-2">
            {filesByDay
              .get(groupKey)
              ?.filter(file => {
                // const files = filesByDay.get(groupKey)
                // const date = getVideoDate(file.name)

                return file.name.endsWith('_A.MP4')
              })
              .map(file => {
                const date = getVideoDate(file.name)
                const [, , videoId, type] = file.name.split('_')

                return (
                  <li
                    key={file.name}
                    className={cns(
                      'text-white font-medium p-2',

                      activeVideo && file.name.includes(activeVideo)
                        ? 'bg-gray-800 hover:bg-gray-900'
                        : 'hover:bg-gray-800',
                    )}
                  >
                    <button
                      onClick={() =>
                        setActiveVideo(file.name.replace('_A.MP4', ''))
                      }
                      type="button"
                    >
                      {date.format('hh:mm:ss a')} - {videoId} - {type}
                    </button>
                  </li>
                )
              })}
          </ul>
        </div>
      ))}

      {/* {files
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
        ))} */}
    </div>
  )
}
