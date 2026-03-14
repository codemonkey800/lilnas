import Skeleton from '@mui/material/Skeleton'

const SKELETON_COUNT = 18

export function GridSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton
            variant="rounded"
            sx={{ aspectRatio: '2/3', width: '100%', height: 'auto' }}
          />
          <Skeleton variant="text" width="80%" />
          <Skeleton variant="text" width="30%" />
        </div>
      ))}
    </div>
  )
}
