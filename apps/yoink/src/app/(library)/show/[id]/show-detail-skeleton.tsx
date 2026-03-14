import Skeleton from '@mui/material/Skeleton'

export function ShowDetailSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="w-full shrink-0 sm:w-48">
          <Skeleton
            variant="rounded"
            width="100%"
            sx={{ aspectRatio: '2/3', height: 'auto' }}
          />
        </div>

        <div className="flex-1 space-y-3">
          <Skeleton variant="text" width="60%" height={40} />
          <Skeleton variant="text" width="40%" height={20} />
          <div className="flex gap-2 pt-1">
            <Skeleton variant="rounded" width={70} height={22} />
            <Skeleton variant="rounded" width={70} height={22} />
            <Skeleton variant="rounded" width={70} height={22} />
          </div>
          <div className="space-y-1 pt-2">
            <Skeleton variant="text" width="100%" />
            <Skeleton variant="text" width="100%" />
            <Skeleton variant="text" width="75%" />
          </div>
          <div className="flex gap-2 pt-3">
            <Skeleton variant="rounded" width={140} height={36} />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <Skeleton variant="text" width={80} height={28} />
        <Skeleton variant="rounded" width="100%" height={64} />
        <Skeleton variant="rounded" width="100%" height={64} />
        <Skeleton variant="rounded" width="100%" height={64} />
      </div>
    </div>
  )
}
