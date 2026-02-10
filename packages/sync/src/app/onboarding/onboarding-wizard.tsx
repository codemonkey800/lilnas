'use client'

import { cns } from '@lilnas/utils/cns'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import {
  HiArrowLeft,
  HiArrowRight,
  HiExclamationCircle,
  HiHeart,
  HiRocketLaunch,
  HiSparkles,
  HiUser,
} from 'react-icons/hi2'

import { AboutYouFields } from 'src/components/profile/about-you-fields'
import { GoalsFields } from 'src/components/profile/goals-fields'
import { LoveConnectionFields } from 'src/components/profile/love-connection-fields'
import { Button } from 'src/components/ui/button'
import { Card } from 'src/components/ui/card'

import { type OnboardingData, saveProfile } from './actions'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
            <>
              <StepHeader
                step={1}
                icon={<HiUser className="h-5 w-5 text-primary-400" />}
                title="About You"
                description="Let's start with the basics so we can personalize your experience."
              />
              <AboutYouFields
                displayName={displayName}
                setDisplayName={setDisplayName}
                birthday={birthday}
                setBirthday={setBirthday}
                pronouns={pronouns}
                setPronouns={setPronouns}
                customPronouns={customPronouns}
                setCustomPronouns={setCustomPronouns}
              />
            </>
          )}

          {step === 1 && (
            <>
              <StepHeader
                step={2}
                icon={<HiHeart className="h-5 w-5 text-primary-400" />}
                title="Love & Connection"
                description="Help us understand what makes you feel loved and what you enjoy."
              />
              <LoveConnectionFields
                loveLang={loveLang}
                setLoveLang={setLoveLang}
                interests={interests}
                toggleInterest={toggleInterest}
                customInterest={customInterest}
                setCustomInterest={setCustomInterest}
                addCustomInterest={addCustomInterest}
              />
            </>
          )}

          {step === 2 && (
            <>
              <StepHeader
                step={3}
                icon={<HiSparkles className="h-5 w-5 text-primary-400" />}
                title="What brings you to Sync?"
                description="Select everything that interests you. This helps us tailor your experience."
              />
              <GoalsFields goals={goals} toggleGoal={toggleGoal} />
            </>
          )}
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
// Step Header (wizard-specific)
// ---------------------------------------------------------------------------

interface StepHeaderProps {
  step: number
  icon: React.ReactNode
  title: string
  description: string
}

function StepHeader({ step, icon, title, description }: StepHeaderProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wider text-primary-400">
        Step {step} of {TOTAL_STEPS}
      </p>
      <h1 className="flex items-center gap-2 text-2xl font-bold text-text md:text-3xl">
        {icon}
        {title}
      </h1>
      <p className="text-sm text-text-secondary">{description}</p>
    </div>
  )
}
