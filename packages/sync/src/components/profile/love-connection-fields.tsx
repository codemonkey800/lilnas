import { cns } from '@lilnas/utils/cns'
import { HiPlus } from 'react-icons/hi2'

import { Button } from 'src/components/ui/button'
import { Input } from 'src/components/ui/input'
import { PillButton } from 'src/components/ui/pill-button'

import { INTEREST_OPTIONS, LOVE_LANGUAGES } from './constants'

export interface LoveConnectionFieldsProps {
  loveLang: string
  setLoveLang: (v: string) => void
  interests: string[]
  toggleInterest: (v: string) => void
  customInterest: string
  setCustomInterest: (v: string) => void
  addCustomInterest: () => void
}

export function LoveConnectionFields({
  loveLang,
  setLoveLang,
  interests,
  toggleInterest,
  customInterest,
  setCustomInterest,
  addCustomInterest,
}: LoveConnectionFieldsProps) {
  return (
    <>
      {/* Love language */}
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-text-secondary">
          Your primary love language
          <span className="ml-1.5 text-xs text-text-muted">(optional)</span>
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {LOVE_LANGUAGES.map(lang => (
            <button
              key={lang.id}
              type="button"
              onClick={() => setLoveLang(lang.id)}
              className={cns(
                'flex items-start gap-3 rounded-md border p-3 text-left',
                'transition-all duration-150 ease-smooth',
                'focus-visible:shadow-focus',
                loveLang === lang.id
                  ? 'border-primary bg-primary-900/40 shadow-glow'
                  : 'border-border bg-bg-raised hover:border-primary-700',
              )}
            >
              <span
                className={cns(
                  'mt-0.5 shrink-0',
                  loveLang === lang.id ? 'text-primary-400' : 'text-text-muted',
                )}
              >
                <lang.Icon className="h-6 w-6" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span
                  className={cns(
                    'text-sm font-medium',
                    loveLang === lang.id ? 'text-text' : 'text-text-secondary',
                  )}
                >
                  {lang.label}
                </span>
                <span className="text-xs text-text-muted">
                  {lang.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Interests */}
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-text-secondary">
          Your interests
          <span className="ml-1.5 text-xs text-text-muted">(optional)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map(interest => (
            <PillButton
              key={interest}
              selected={interests.includes(interest)}
              onClick={() => toggleInterest(interest)}
            >
              {interest}
            </PillButton>
          ))}
          {/* Custom interests added by user */}
          {interests
            .filter(
              i =>
                !INTEREST_OPTIONS.includes(
                  i as (typeof INTEREST_OPTIONS)[number],
                ),
            )
            .map(interest => (
              <PillButton
                key={interest}
                selected
                onClick={() => toggleInterest(interest)}
              >
                {interest}
              </PillButton>
            ))}
        </div>
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Add your own..."
            value={customInterest}
            onChange={e => setCustomInterest(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustomInterest()
              }
            }}
            className="flex-1 py-1.5"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addCustomInterest}
            disabled={!customInterest.trim()}
          >
            <HiPlus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>
    </>
  )
}
