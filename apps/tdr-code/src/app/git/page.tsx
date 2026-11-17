'use client'

import { type JSX, useState } from 'react'

import { useSession } from 'src/app/lib/auth-client'

import { GithubSection } from './github-section'
import { RosterSection } from './roster-section'
import { SshSection } from './ssh-section'

export default function GitPage(): JSX.Element {
  const { isPending: sessionPending } = useSession()
  const [discordUserId, setDiscordUserId] = useState<string | undefined>(
    undefined,
  )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 md:gap-5 md:px-8">
      <h1 className="text-h2">Git</h1>

      <GithubSection
        onDiscordUserId={setDiscordUserId}
        sessionPending={sessionPending}
      />

      <SshSection discordUserId={discordUserId} />

      <RosterSection />
    </div>
  )
}
