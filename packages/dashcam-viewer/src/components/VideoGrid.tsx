import { useAtomValue } from 'jotai'

import { videoUrlsAtom } from 'src/state'

import { Video } from './Video'
import { useEffect, useRef } from 'react'

export function VideoGrid() {
  const videoUrls = useAtomValue(videoUrlsAtom)

  const cabinVideoRef = useRef<HTMLVideoElement>(null)
  const rearVideoRef = useRef<HTMLVideoElement>(null)
  const frontVideoRef = useRef<HTMLVideoElement>(null)
  const videoRefs = [rearVideoRef, cabinVideoRef]

  useEffect(() => {
    function onPause() {
      videoRefs.forEach(video => video.current?.pause())
    }

    function onPlay() {
      videoRefs.forEach(video => video.current?.play())
    }

    const mainVideo = frontVideoRef.current

    function onUpdateTimeStamp() {
      videoRefs.forEach(ref => {
        const video = ref.current
        const nextTime = mainVideo?.currentTime
        if (video && nextTime) {
          video.currentTime = nextTime
        }
      })
    }

    mainVideo?.addEventListener('pause', onPause)
    mainVideo?.addEventListener('play', onPlay)
    mainVideo?.addEventListener('seeking', onUpdateTimeStamp)

    return () => {
      mainVideo?.removeEventListener('pause', onPause)
      mainVideo?.removeEventListener('play', onPlay)
      mainVideo?.removeEventListener('seeking', onUpdateTimeStamp)
    }
  }, [videoUrls.state])

  return (
    <div className="flex flex-col flex-auto relative">
      <div className="absolute top-2 left-2 w-[30%]">
        <Video
          placeholder="Cabin"
          url={videoUrls.state === 'hasData' ? videoUrls.data.cabin : ''}
          videoRef={cabinVideoRef}
        />
      </div>

      <div className="absolute top-2 right-2 w-[30%]">
        <Video
          placeholder="Rear"
          url={videoUrls.state === 'hasData' ? videoUrls.data.rear : ''}
          videoRef={rearVideoRef}
        />
      </div>

      <div className="flex flex-auto">
        <Video
          placeholder="Front"
          url={videoUrls.state === 'hasData' ? videoUrls.data.front : ''}
          videoRef={frontVideoRef}
          main
        />
      </div>
    </div>
  )
}
