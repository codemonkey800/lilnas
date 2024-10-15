import { VideoGrid } from './VideoGrid'
import { VideoPicker } from './VideoPicker'

export function VideoPlayer() {
  return (
    <div className="flex flex-auto">
      <VideoPicker />
      <VideoGrid />
    </div>
  )
}
