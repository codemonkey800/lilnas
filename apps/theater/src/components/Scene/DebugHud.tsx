'use client'

import { Telemetry } from './Player'

type DebugHudProps = {
  telemetry: Telemetry
}

function fmt(value: number): string {
  return value.toFixed(2)
}

export function DebugHud({ telemetry }: DebugHudProps) {
  const { position, velocity } = telemetry

  return (
    <div className="pointer-events-none absolute right-4 top-4 rounded bg-black/60 px-3 py-2 font-mono text-xs">
      <div>
        pos x:{fmt(position.x)} y:{fmt(position.y)} z:{fmt(position.z)}
      </div>
      <div>
        vel x:{fmt(velocity.x)} y:{fmt(velocity.y)} z:{fmt(velocity.z)}
      </div>
    </div>
  )
}
