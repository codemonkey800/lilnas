import { RefObject } from 'react'
import { cns } from 'src/utils/cns'

export function Video({
  placeholder,
  url,
  videoRef,
  main,
}: {
  placeholder: string
  url: string
  videoRef: RefObject<HTMLVideoElement>
  main?: boolean
}) {
  return (
    <div
      className={cns(
        'flex items-center justify-center flex-auto',
        'bg-black border-purple-300',
      )}
    >
      {url ? (
        <video
          className="flex flex-auto"
          controls={main}
          muted={!main}
          autoPlay
          src={url}
          ref={videoRef}
        />
      ) : (
        <p className="text-white text-3xl font-bold">{placeholder}</p>
      )}
    </div>
  )
}
