import { FormField } from 'src/components/ui/form-field'
import { Input } from 'src/components/ui/input'
import { PillButton } from 'src/components/ui/pill-button'

import { PRONOUNS_OPTIONS } from './constants'

export interface AboutYouFieldsProps {
  displayName: string
  setDisplayName: (v: string) => void
  birthday: string
  setBirthday: (v: string) => void
  pronouns: string
  setPronouns: (v: string) => void
  customPronouns: string
  setCustomPronouns: (v: string) => void
}

export function AboutYouFields({
  displayName,
  setDisplayName,
  birthday,
  setBirthday,
  pronouns,
  setPronouns,
  customPronouns,
  setCustomPronouns,
}: AboutYouFieldsProps) {
  return (
    <>
      {/* Display name */}
      <FormField label="What should we call you?">
        <Input
          type="text"
          required
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
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-text-secondary">
          Pronouns
          <span className="ml-1.5 text-xs text-text-muted">(optional)</span>
        </p>
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
      </div>
    </>
  )
}
