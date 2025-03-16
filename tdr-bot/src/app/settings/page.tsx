import { Paper } from '@mui/material'
import { ReactNode } from 'react'

import { BotSettings } from 'src/components/BotSettings/BotSettings'

function SettingsCard({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <Paper className="p-3 md:p-4 w-full max-w-[800px]" elevation={4}>
      <h4 className="text-4xl font-bold">{title}</h4>
      {children}
    </Paper>
  )
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4 items-center">
      <SettingsCard title="Bot">
        <BotSettings />
      </SettingsCard>
    </div>
  )
}
