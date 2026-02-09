'use client'

import { cns } from '@lilnas/utils/cns'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import {
  HiArrowLeft,
  HiArrowRight,
  HiChatBubbleBottomCenterText,
  HiCheck,
  HiClock,
  HiExclamationCircle,
  HiGift,
  HiHandRaised,
  HiHeart,
  HiPlus,
  HiRocketLaunch,
  HiSparkles,
  HiUser,
} from 'react-icons/hi2'

import { Button } from 'src/components/ui/button'
import { Card } from 'src/components/ui/card'
import { FormField } from 'src/components/ui/form-field'
import { Input } from 'src/components/ui/input'
import { PillButton } from 'src/components/ui/pill-button'

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
    icon: <HiChatBubbleBottomCenterText className="h-6 w-6" />,
  },
  {
    id: 'acts-of-service',
    label: 'Acts of Service',
    description: 'Helpful actions & thoughtful deeds',
    icon: <HiHeart className="h-6 w-6" />,
  },
  {
    id: 'receiving-gifts',
    label: 'Receiving Gifts',
    description: 'Thoughtful presents & surprises',
    icon: <HiGift className="h-6 w-6" />,
  },
  {
    id: 'quality-time',
    label: 'Quality Time',
    description: 'Undivided attention & togetherness',
    icon: <HiClock className="h-6 w-6" />,
  },
  {
    id: 'physical-touch',
    label: 'Physical Touch',
    description: 'Hugs, closeness & physical presence',
    icon: <HiHandRaised className="h-6 w-6" />,
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
    <Card>
      <form onSubmit={handleSubmit} className="contents">
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
        {error && (
          <p className="flex items-center gap-1.5 text-sm text-error animate-fade-in">
            <HiExclamationCircle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between gap-3">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={handleBack}>
              <HiArrowLeft className="h-4 w-4" />
              Back
            </Button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS - 1 ? (
            <Button
              key="continue"
              type="button"
              size="lg"
              onClick={handleNext}
              disabled={!canContinue()}
            >
              Continue
              <HiArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              key="submit"
              type="submit"
              size="lg"
              disabled={!canContinue()}
              loading={loading}
            >
              {loading ? 'Saving...' : 'Get Started'}
              {!loading && <HiRocketLaunch className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </form>
    </Card>
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
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text md:text-3xl">
          <HiUser className="h-5 w-5 text-primary-400" />
          About You
        </h1>
        <p className="text-sm text-text-secondary">
          Let&apos;s start with the basics so we can personalize your
          experience.
        </p>
      </div>

      {/* Display name */}
      <FormField label="What should we call you?">
        <Input
          type="text"
          required
          autoFocus
          autoComplete="given-name"
          placeholder="Your name"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
        />
      </FormField>

      {/* Birthday */}
      <FormField
        label={
          <>
            Birthday
            <span className="ml-1.5 text-xs text-text-muted">(optional)</span>
          </>
        }
      >
        <Input
          type="date"
          value={birthday}
          onChange={e => setBirthday(e.target.value)}
          className="[color-scheme:dark]"
        />
      </FormField>

      {/* Pronouns */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text-secondary">
          Pronouns
          <span className="ml-1.5 text-xs text-text-muted">(optional)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {PRONOUNS_OPTIONS.map(option => (
            <PillButton
              key={option}
              selected={pronouns === option}
              onClick={() => setPronouns(option)}
            >
              {option}
            </PillButton>
          ))}
          <PillButton
            selected={pronouns === 'custom'}
            onClick={() => setPronouns('custom')}
          >
            Other
          </PillButton>
        </div>
        {pronouns === 'custom' && (
          <Input
            type="text"
            autoFocus
            placeholder="Enter your pronouns"
            value={customPronouns}
            onChange={e => setCustomPronouns(e.target.value)}
            className="mt-1 animate-fade-in"
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
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text md:text-3xl">
          <HiHeart className="h-5 w-5 text-primary-400" />
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
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text md:text-3xl">
          <HiSparkles className="h-5 w-5 text-primary-400" />
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
                <HiCheck className="h-3 w-3" />
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
