'use client'

import { cns } from '@lilnas/utils/cns'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { type OnboardingData, saveProfile } from './actions'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRONOUNS_OPTIONS = ['he/him', 'she/her', 'they/them'] as const

const LOVE_LANGUAGES = [
  {
    id: 'words-of-affirmation',
    label: 'Words of Affirmation',
    description: 'Verbal compliments & encouragement',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M12 7v2" />
        <path d="M12 13h.01" />
      </svg>
    ),
  },
  {
    id: 'acts-of-service',
    label: 'Acts of Service',
    description: 'Helpful actions & thoughtful deeds',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
  },
  {
    id: 'receiving-gifts',
    label: 'Receiving Gifts',
    description: 'Thoughtful presents & surprises',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
      >
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M12 8v13" />
        <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
        <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 4.8 0 0 1 12 8a4.8 4.8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
      </svg>
    ),
  },
  {
    id: 'quality-time',
    label: 'Quality Time',
    description: 'Undivided attention & togetherness',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: 'physical-touch',
    label: 'Physical Touch',
    description: 'Hugs, closeness & physical presence',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
      >
        <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
        <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </svg>
    ),
  },
] as const

const INTEREST_OPTIONS = [
  'Cooking',
  'Hiking',
  'Movies',
  'Gaming',
  'Travel',
  'Reading',
  'Music',
  'Fitness',
  'Art',
  'Photography',
  'Dancing',
  'Board Games',
  'Sports',
  'Wine & Dining',
  'Gardening',
  'Yoga',
] as const

const GOAL_OPTIONS = [
  'Better communication',
  'Date night ideas',
  'Gift inspiration',
  'Conflict resolution',
  'Remembering important dates',
  'Deepening emotional connection',
  'Understanding each other better',
  'Fun activities together',
] as const

const TOTAL_STEPS = 3

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingWizard() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [displayName, setDisplayName] = useState('')
  const [birthday, setBirthday] = useState('')
  const [pronouns, setPronouns] = useState('')
  const [customPronouns, setCustomPronouns] = useState('')
  const [loveLang, setLoveLang] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [customInterest, setCustomInterest] = useState('')
  const [goals, setGoals] = useState<string[]>([])

  const resolvedPronouns = pronouns === 'custom' ? customPronouns : pronouns

  function canContinue(): boolean {
    if (step === 0) return displayName.trim().length > 0
    return true
  }

  function handleNext() {
    if (step < TOTAL_STEPS - 1) {
      setStep(s => s + 1)
      setError(null)
    }
  }

  function handleBack() {
    if (step > 0) {
      setStep(s => s - 1)
      setError(null)
    }
  }

  function toggleInterest(interest: string) {
    setInterests(prev =>
      prev.includes(interest)
        ? prev.filter(i => i !== interest)
        : [...prev, interest],
    )
  }

  function addCustomInterest() {
    const trimmed = customInterest.trim()
    if (trimmed && !interests.includes(trimmed)) {
      setInterests(prev => [...prev, trimmed])
      setCustomInterest('')
    }
  }

  function toggleGoal(goal: string) {
    setGoals(prev =>
      prev.includes(goal) ? prev.filter(g => g !== goal) : [...prev, goal],
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const data: OnboardingData = {
      displayName: displayName.trim(),
      birthday,
      pronouns: resolvedPronouns,
      loveLang,
      interests,
      goals,
    }

    const result = await saveProfile(data)

    setLoading(false)

    if (result.success) {
      router.push('/')
    } else {
      setError(result.error)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cns(
        'flex w-full max-w-lg flex-col gap-6',
        'rounded-md border border-border bg-bg-surface p-6 shadow-md md:p-8',
        'animate-fade-in',
      )}
    >
      {/* Progress */}
      <div className="flex items-center gap-2">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={cns(
              'h-1.5 flex-1 rounded-full transition-colors duration-300 ease-smooth',
              i <= step ? 'bg-primary' : 'bg-bg-overlay',
            )}
          />
        ))}
      </div>

      {/* Step content */}
      <div key={step} className="flex flex-col gap-6 animate-slide-up">
        {step === 0 && (
          <StepAboutYou
            displayName={displayName}
            setDisplayName={setDisplayName}
            birthday={birthday}
            setBirthday={setBirthday}
            pronouns={pronouns}
            setPronouns={setPronouns}
            customPronouns={customPronouns}
            setCustomPronouns={setCustomPronouns}
          />
        )}

        {step === 1 && (
          <StepLoveConnection
            loveLang={loveLang}
            setLoveLang={setLoveLang}
            interests={interests}
            toggleInterest={toggleInterest}
            customInterest={customInterest}
            setCustomInterest={setCustomInterest}
            addCustomInterest={addCustomInterest}
          />
        )}

        {step === 2 && <StepGoals goals={goals} toggleGoal={toggleGoal} />}
      </div>

      {/* Error */}
      {error && <p className="text-sm text-error animate-fade-in">{error}</p>}

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={handleBack}
            className={cns(
              'inline-flex items-center justify-center rounded-sm px-4 py-2',
              'text-sm font-medium text-text-secondary',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-bg-overlay hover:text-text',
              'focus-visible:shadow-focus',
            )}
          >
            Back
          </button>
        ) : (
          <div />
        )}

        {step < TOTAL_STEPS - 1 ? (
          <button
            key="continue"
            type="button"
            onClick={handleNext}
            disabled={!canContinue()}
            className={cns(
              'inline-flex items-center justify-center rounded-sm px-5 py-2',
              'bg-primary text-sm font-medium text-text-inverse',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-primary-600',
              'focus-visible:shadow-focus',
              'disabled:opacity-40',
            )}
          >
            Continue
          </button>
        ) : (
          <button
            key="submit"
            type="submit"
            disabled={loading || !canContinue()}
            className={cns(
              'inline-flex items-center justify-center rounded-sm px-5 py-2',
              'bg-primary text-sm font-medium text-text-inverse',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-primary-600',
              'focus-visible:shadow-focus',
              'disabled:opacity-40',
            )}
          >
            {loading ? 'Saving...' : 'Get Started'}
          </button>
        )}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Step 1: About You
// ---------------------------------------------------------------------------

interface StepAboutYouProps {
  displayName: string
  setDisplayName: (v: string) => void
  birthday: string
  setBirthday: (v: string) => void
  pronouns: string
  setPronouns: (v: string) => void
  customPronouns: string
  setCustomPronouns: (v: string) => void
}

function StepAboutYou({
  displayName,
  setDisplayName,
  birthday,
  setBirthday,
  pronouns,
  setPronouns,
  customPronouns,
  setCustomPronouns,
}: StepAboutYouProps) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-primary-400">
          Step 1 of {TOTAL_STEPS}
        </p>
        <h1 className="text-2xl font-bold text-text md:text-3xl">About You</h1>
        <p className="text-sm text-text-secondary">
          Let&apos;s start with the basics so we can personalize your
          experience.
        </p>
      </div>

      {/* Display name */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text-secondary">
          What should we call you?
        </span>
        <input
          type="text"
          required
          autoFocus
          autoComplete="given-name"
          placeholder="Your name"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          className={cns(
            'w-full rounded-sm border border-border bg-bg-raised px-3 py-2',
            'text-sm text-text placeholder:text-text-muted',
            'transition-colors duration-150 ease-smooth',
            'focus:border-primary focus:outline-none focus-visible:shadow-focus',
          )}
        />
      </label>

      {/* Birthday */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text-secondary">
          Birthday
          <span className="ml-1.5 text-xs text-text-muted">(optional)</span>
        </span>
        <input
          type="date"
          value={birthday}
          onChange={e => setBirthday(e.target.value)}
          className={cns(
            'w-full rounded-sm border border-border bg-bg-raised px-3 py-2',
            'text-sm text-text',
            'transition-colors duration-150 ease-smooth',
            'focus:border-primary focus:outline-none focus-visible:shadow-focus',
            '[color-scheme:dark]',
          )}
        />
      </label>

      {/* Pronouns */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text-secondary">
          Pronouns
          <span className="ml-1.5 text-xs text-text-muted">(optional)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {PRONOUNS_OPTIONS.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => setPronouns(option)}
              className={cns(
                'rounded-full border px-3 py-1.5 text-sm font-medium',
                'transition-all duration-150 ease-smooth',
                'focus-visible:shadow-focus',
                pronouns === option
                  ? 'border-primary bg-primary-900 text-primary-300'
                  : 'border-border bg-bg-raised text-text-secondary hover:border-primary-700 hover:text-text',
              )}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPronouns('custom')}
            className={cns(
              'rounded-full border px-3 py-1.5 text-sm font-medium',
              'transition-all duration-150 ease-smooth',
              'focus-visible:shadow-focus',
              pronouns === 'custom'
                ? 'border-primary bg-primary-900 text-primary-300'
                : 'border-border bg-bg-raised text-text-secondary hover:border-primary-700 hover:text-text',
            )}
          >
            Other
          </button>
        </div>
        {pronouns === 'custom' && (
          <input
            type="text"
            autoFocus
            placeholder="Enter your pronouns"
            value={customPronouns}
            onChange={e => setCustomPronouns(e.target.value)}
            className={cns(
              'mt-1 w-full rounded-sm border border-border bg-bg-raised px-3 py-2',
              'text-sm text-text placeholder:text-text-muted',
              'transition-colors duration-150 ease-smooth',
              'focus:border-primary focus:outline-none focus-visible:shadow-focus',
              'animate-fade-in',
            )}
          />
        )}
      </fieldset>
    </>
  )
}

// ---------------------------------------------------------------------------
// Step 2: Love & Connection
// ---------------------------------------------------------------------------

interface StepLoveConnectionProps {
  loveLang: string
  setLoveLang: (v: string) => void
  interests: string[]
  toggleInterest: (v: string) => void
  customInterest: string
  setCustomInterest: (v: string) => void
  addCustomInterest: () => void
}

function StepLoveConnection({
  loveLang,
  setLoveLang,
  interests,
  toggleInterest,
  customInterest,
  setCustomInterest,
  addCustomInterest,
}: StepLoveConnectionProps) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-primary-400">
          Step 2 of {TOTAL_STEPS}
        </p>
        <h1 className="text-2xl font-bold text-text md:text-3xl">
          Love &amp; Connection
        </h1>
        <p className="text-sm text-text-secondary">
          Help us understand what makes you feel loved and what you enjoy.
        </p>
      </div>

      {/* Love language */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-text-secondary">
          Your primary love language
          <span className="ml-1.5 text-xs text-text-muted">(optional)</span>
        </legend>
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
                {lang.icon}
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
      </fieldset>

      {/* Interests */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-text-secondary">
          Your interests
          <span className="ml-1.5 text-xs text-text-muted">(optional)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map(interest => (
            <button
              key={interest}
              type="button"
              onClick={() => toggleInterest(interest)}
              className={cns(
                'rounded-full border px-3 py-1.5 text-sm font-medium',
                'transition-all duration-150 ease-smooth',
                'focus-visible:shadow-focus',
                interests.includes(interest)
                  ? 'border-primary bg-primary-900 text-primary-300'
                  : 'border-border bg-bg-raised text-text-secondary hover:border-primary-700 hover:text-text',
              )}
            >
              {interest}
            </button>
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
              <button
                key={interest}
                type="button"
                onClick={() => toggleInterest(interest)}
                className={cns(
                  'rounded-full border px-3 py-1.5 text-sm font-medium',
                  'transition-all duration-150 ease-smooth',
                  'focus-visible:shadow-focus',
                  'border-primary bg-primary-900 text-primary-300',
                )}
              >
                {interest}
              </button>
            ))}
        </div>
        <div className="flex gap-2">
          <input
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
            className={cns(
              'flex-1 rounded-sm border border-border bg-bg-raised px-3 py-1.5',
              'text-sm text-text placeholder:text-text-muted',
              'transition-colors duration-150 ease-smooth',
              'focus:border-primary focus:outline-none focus-visible:shadow-focus',
            )}
          />
          <button
            type="button"
            onClick={addCustomInterest}
            disabled={!customInterest.trim()}
            className={cns(
              'inline-flex items-center justify-center rounded-sm px-3 py-1.5',
              'border border-border bg-bg-raised text-sm font-medium text-text-secondary',
              'transition-colors duration-150 ease-smooth',
              'hover:bg-bg-overlay hover:text-text',
              'focus-visible:shadow-focus',
              'disabled:opacity-40',
            )}
          >
            Add
          </button>
        </div>
      </fieldset>
    </>
  )
}

// ---------------------------------------------------------------------------
// Step 3: Goals
// ---------------------------------------------------------------------------

interface StepGoalsProps {
  goals: string[]
  toggleGoal: (v: string) => void
}

function StepGoals({ goals, toggleGoal }: StepGoalsProps) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-primary-400">
          Step 3 of {TOTAL_STEPS}
        </p>
        <h1 className="text-2xl font-bold text-text md:text-3xl">
          What brings you to Sync?
        </h1>
        <p className="text-sm text-text-secondary">
          Select everything that interests you. This helps us tailor your
          experience.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {GOAL_OPTIONS.map(goal => (
          <button
            key={goal}
            type="button"
            onClick={() => toggleGoal(goal)}
            className={cns(
              'flex items-center gap-3 rounded-md border p-3 text-left',
              'transition-all duration-150 ease-smooth',
              'focus-visible:shadow-focus',
              goals.includes(goal)
                ? 'border-primary bg-primary-900/40 shadow-glow'
                : 'border-border bg-bg-raised hover:border-primary-700',
            )}
          >
            {/* Checkbox indicator */}
            <span
              className={cns(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded',
                'border transition-all duration-150 ease-smooth',
                goals.includes(goal)
                  ? 'border-primary bg-primary text-text-inverse'
                  : 'border-border bg-bg-surface',
              )}
            >
              {goals.includes(goal) && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            <span
              className={cns(
                'text-sm font-medium',
                goals.includes(goal) ? 'text-text' : 'text-text-secondary',
              )}
            >
              {goal}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
