import { atom } from 'jotai'
import { loadable } from 'jotai/utils'

export enum AppState {
  FilePicker,
  VideoPlayer,
}

export enum VideoType {
  Cabin = 'B',
  Front = 'A',
  Rear = 'C',
}

export const appStateAtom = atom(AppState.FilePicker)

export const filesAtom = atom<FileSystemFileHandle[]>([])

export const activeVideoAtom = atom('')

export const videoUrlsAtom = loadable(
  atom(async get => {
    const files = get(filesAtom)
    const activeVideo = get(activeVideoAtom)

    async function getVideoUrlByType(type: VideoType) {
      const file = files.find(
        file =>
          activeVideo &&
          file.name.includes(activeVideo) &&
          file.name.endsWith(`_${type}.MP4`),
      )

      if (!file) {
        return ''
      }

      console.log('breh', file.name)

      return URL.createObjectURL(await file.getFile())
    }

    const [cabin, front, rear] = await Promise.all([
      getVideoUrlByType(VideoType.Cabin),
      getVideoUrlByType(VideoType.Front),
      getVideoUrlByType(VideoType.Rear),
    ])

    return { cabin, front, rear }
  }),
)
