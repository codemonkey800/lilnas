// jotai 3 ships a `types` fallback file for every entry point, so the
// import resolver sees these two imports as the same module.
/* eslint-disable import-x/no-duplicates */
import { Atom, atom } from 'jotai'
import { unwrap } from 'jotai/utils'
/* eslint-enable import-x/no-duplicates */

type Loadable<Value> =
  | { state: 'loading' }
  | { state: 'hasError'; error: unknown }
  | { state: 'hasData'; data: Awaited<Value> }

// jotai 3 dropped `loadable`; this is the userland replacement from its
// migration guide, built on `unwrap`.
function loadable<Value>(anAtom: Atom<Value>): Atom<Loadable<Value>> {
  const LOADING: Loadable<Value> = { state: 'loading' }
  const unwrappedAtom = unwrap(anAtom, () => LOADING)

  return atom(get => {
    try {
      const data = get(unwrappedAtom)
      if (data === LOADING) {
        return LOADING
      }

      return { state: 'hasData', data: data as Awaited<Value> }
    } catch (error) {
      return { state: 'hasError', error }
    }
  })
}

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
