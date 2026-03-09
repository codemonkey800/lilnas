import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Card from '@mui/material/Card'

import { SectionHeader } from 'src/components/section-header'
import { StorageBar } from 'src/components/storage-bar'
import type { StorageOverview } from 'src/media/storage.types'

import { CompactStorageRow } from './compact-storage-row'
import { LargestItemRow, PodiumCard } from './largest-items'
import { StorageSummary } from './storage-summary'
import { usageRatio, WARNING_THRESHOLD } from './storage.utils'

interface StorageContentProps {
  data: StorageOverview
}

export function StorageContent({ data }: StorageContentProps) {
  const { rootFolders, largestItems } = data

  const lowSpaceFolders = rootFolders.filter(
    f => usageRatio(f.freeSpace, f.totalSpace) >= WARNING_THRESHOLD,
  )
  const hasLowSpace = lowSpaceFolders.length > 0

  const mediaVolumes = rootFolders.filter(
    f => f.moviesBytes > 0 || f.showsBytes > 0,
  )
  const systemVolumes = rootFolders.filter(
    f => f.moviesBytes === 0 && f.showsBytes === 0,
  )

  const topThree = largestItems.slice(0, 3)
  const restItems = largestItems.slice(3)
  const maxSize = largestItems[0]?.sizeOnDisk ?? 1

  return (
    <div className="space-y-8">
      <h1 className="font-sans text-3xl font-bold text-carbon-50">Storage</h1>

      {hasLowSpace && (
        <Card
          className="animate-fade-in flex items-start gap-3 border-warning/30 bg-warning-muted p-4"
          sx={{ backgroundColor: 'var(--color-warning-muted)' }}
        >
          <WarningAmberIcon
            className="mt-0.5 shrink-0 text-warning"
            sx={{ fontSize: 18 }}
          />
          <div>
            <p className="font-mono text-sm font-medium text-warning">
              Low disk space
            </p>
            <p className="mt-0.5 text-xs text-carbon-300">
              {lowSpaceFolders.length === 1
                ? `${lowSpaceFolders[0]!.path} is running low on space.`
                : `${lowSpaceFolders.length} volumes are running low on space.`}
            </p>
          </div>
        </Card>
      )}

      {rootFolders.length > 0 && <StorageSummary rootFolders={rootFolders} />}

      {mediaVolumes.length > 0 && (
        <section>
          <SectionHeader>Media Volumes</SectionHeader>
          <div className="space-y-3">
            {mediaVolumes.map((folder, i) => {
              const used = folder.totalSpace - folder.freeSpace
              return (
                <div
                  key={folder.path}
                  className="animate-fade-in"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <StorageBar
                    label={folder.path}
                    usedBytes={used}
                    totalBytes={folder.totalSpace}
                    moviesBytes={folder.moviesBytes}
                    showsBytes={folder.showsBytes}
                    warningThreshold={WARNING_THRESHOLD}
                  />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {systemVolumes.length > 0 && (
        <section>
          <SectionHeader>System Volumes</SectionHeader>
          <Card className="divide-y divide-carbon-700/50 px-4 py-1">
            {systemVolumes.map((folder, i) => (
              <div
                key={folder.path}
                className="animate-fade-in"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <CompactStorageRow folder={folder} />
              </div>
            ))}
          </Card>
        </section>
      )}

      {largestItems.length > 0 && (
        <section>
          <SectionHeader>Largest Items</SectionHeader>

          {topThree.length > 0 && (
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {topThree.map((item, i) => (
                <PodiumCard
                  key={item.href}
                  item={item}
                  rank={i + 1}
                  maxSize={maxSize}
                  index={i}
                />
              ))}
            </div>
          )}

          {restItems.length > 0 && (
            <Card className="overflow-hidden p-0">
              <div className="flex items-center gap-3 border-b border-carbon-600 px-4 py-2">
                <span className="hidden w-7 shrink-0 sm:block" />
                <span className="w-3.5 shrink-0" />
                <span className="flex-1 font-mono text-xs font-semibold uppercase tracking-widest text-carbon-500">
                  Title
                </span>
                <span className="hidden font-mono text-xs font-semibold uppercase tracking-widest text-carbon-500 md:block">
                  Volume
                </span>
                <span className="w-20 shrink-0 text-right font-mono text-xs font-semibold uppercase tracking-widest text-carbon-500">
                  Size
                </span>
              </div>

              <div>
                {restItems.map((item, i) => (
                  <LargestItemRow
                    key={`${item.href}-${i}`}
                    item={item}
                    rank={i + 4}
                    index={i}
                  />
                ))}
              </div>
            </Card>
          )}
        </section>
      )}

      {rootFolders.length === 0 && (
        <Card className="p-6 text-center">
          <p className="font-mono text-sm text-carbon-400">
            No storage volumes found.
          </p>
        </Card>
      )}
    </div>
  )
}
