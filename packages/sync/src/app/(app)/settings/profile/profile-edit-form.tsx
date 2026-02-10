'use client'

import { FormEvent, useState } from 'react'
import {
  HiCheck,
  HiExclamationCircle,
  HiHeart,
  HiSparkles,
  HiUser,
} from 'react-icons/hi2'

import { AboutYouFields } from 'src/components/profile/about-you-fields'
import { GoalsFields } from 'src/components/profile/goals-fields'
import { LoveConnectionFields } from 'src/components/profile/love-connection-fields'
import { Button } from 'src/components/ui/button'

import { type ProfileData, updateProfile } from '../actions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileEditFormProps {
  initialData: {
    displayName: string
    birthday: string | null
    pronouns: string | null
    loveLang: string | null
    interests: string | null
    goals: string | null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

/** Determine whether the pronouns value is a preset or custom. */
function resolveInitialPronouns(pronouns: string | null) {
  const presets = ['he/him', 'she/her', 'they/them']
  if (!pronouns) return { pronouns: '', customPronouns: '' }
  if (presets.includes(pronouns)) return { pronouns, customPronouns: '' }
  return { pronouns: 'custom', customPronouns: pronouns }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProfileEditForm({ initialData }: ProfileEditFormProps) {
  // About You
  const [displayName, setDisplayName] = useState(initialData.displayName)
  const [birthday, setBirthday] = useState(initialData.birthday ?? '')
  const initialPronouns = resolveInitialPronouns(initialData.pronouns)
  const [pronouns, setPronouns] = useState(initialPronouns.pronouns)
  const [customPronouns, setCustomPronouns] = useState(
    initialPronouns.customPronouns,
  )

  // Love & Connection
  const [loveLang, setLoveLang] = useState(initialData.loveLang ?? '')
  const [interests, setInterests] = useState<string[]>(
    parseJsonArray(initialData.interests),
  )
  const [customInterest, setCustomInterest] = useState('')

  // Goals
  const [goals, setGoals] = useState<string[]>(
    parseJsonArray(initialData.goals),
  )

  // UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const resolvedPronouns = pronouns === 'custom' ? customPronouns : pronouns

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
    setSuccess(false)
    setLoading(true)

    const data: ProfileData = {
      displayName: displayName.trim(),
      birthday,
      pronouns: resolvedPronouns,
      loveLang,
      interests,
      goals,
    }

    const result = await updateProfile(data)

    setLoading(false)

    if (result.success) {
      setSuccess(true)
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000)
    } else {
      setError(result.error)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-10">
      {/* About You */}
      <section className="flex flex-col gap-6">
        <SectionHeader
          icon={<HiUser className="h-5 w-5 text-primary-400" />}
          title="About You"
          description="The basics -- your name, birthday, and pronouns."
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
      </section>

      {/* Love & Connection */}
      <section className="flex flex-col gap-6">
        <SectionHeader
          icon={<HiHeart className="h-5 w-5 text-primary-400" />}
          title="Love & Connection"
          description="Your love language and shared interests."
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
      </section>

      {/* Goals */}
      <section className="flex flex-col gap-6">
        <SectionHeader
          icon={<HiSparkles className="h-5 w-5 text-primary-400" />}
          title="Your Goals"
          description="What you want to get out of Sync."
        />
        <GoalsFields goals={goals} toggleGoal={toggleGoal} />
      </section>

      {/* Feedback + Submit */}
      <div className="flex flex-col gap-3">
        {error && (
          <p className="flex items-center gap-1.5 text-sm text-error animate-fade-in">
            <HiExclamationCircle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {success && (
          <p className="flex items-center gap-1.5 text-sm text-success animate-fade-in">
            <HiCheck className="h-4 w-4 shrink-0" />
            Profile updated successfully.
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={!displayName.trim()}
          loading={loading}
          className="self-start"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Section Header (profile page-specific)
// ---------------------------------------------------------------------------

interface SectionHeaderProps {
  icon: React.ReactNode
  title: string
  description: string
}

function SectionHeader({ icon, title, description }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-text">
        {icon}
        {title}
      </h2>
      <p className="text-sm text-text-secondary">{description}</p>
    </div>
  )
}
