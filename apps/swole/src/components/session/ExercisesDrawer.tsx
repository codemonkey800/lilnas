'use client'

import { cns } from '@lilnas/utils/cns'
import CheckIcon from '@mui/icons-material/Check'
import Drawer from '@mui/material/Drawer'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Typography from '@mui/material/Typography'
import { useRef } from 'react'

import type { ExerciseListItem } from 'src/lib/runner'

export type ExercisesDrawerProps = {
  open: boolean
  exercises: ExerciseListItem[]
  onJump: (idx: number) => void
  onReview: (idx: number) => void
  onClose: () => void
}

function progressLabel(item: ExerciseListItem): string {
  if (item.status === 'done') return '✓'
  if (item.status === 'unstarted') return '○'
  return `${item.loggedCount}/${item.sets}`
}

export function ExercisesDrawer({
  open,
  exercises,
  onJump,
  onReview,
  onClose,
}: ExercisesDrawerProps) {
  const currentRef = useRef<HTMLDivElement | null>(null)

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        transition: {
          onEntered: () =>
            currentRef.current?.scrollIntoView({ block: 'nearest' }),
        },
      }}
      PaperProps={{
        className:
          'rounded-t-2xl !bg-neutral-900 border-t border-neutral-800 !max-h-[70vh]',
      }}
    >
      <div className="px-4 pb-2 pt-4">
        <Typography component="h2" variant="subtitle1" className="!font-bold">
          Exercises
        </Typography>
      </div>

      <List className="overflow-y-auto pb-6">
        {exercises.map(item => (
          <ListItemButton
            key={item.idx}
            ref={item.isCurrent ? currentRef : null}
            onClick={() => {
              if (item.status === 'done') {
                onReview(item.idx)
              } else if (item.isCurrent) {
                onClose()
              } else {
                onJump(item.idx)
              }
            }}
            className={cns('gap-3 !px-4', item.isCurrent && '!bg-neutral-800')}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Typography
                component="span"
                variant="body2"
                className={cns(
                  '!font-medium',
                  item.isCurrent ? '!text-orange-400' : '!text-white',
                )}
              >
                {item.name}
              </Typography>
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
              >
                {item.type}
              </Typography>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {item.status === 'done' && (
                <CheckIcon className="!text-sm !text-orange-400" />
              )}
              <Typography
                component="span"
                variant="caption"
                className={cns(
                  item.status === 'done' && '!text-orange-400',
                  item.isCurrent &&
                    item.status !== 'done' &&
                    '!text-orange-300',
                )}
              >
                {progressLabel(item)}
              </Typography>
            </div>
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  )
}
