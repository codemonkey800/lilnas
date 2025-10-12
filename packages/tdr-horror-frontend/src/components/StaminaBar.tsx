import { usePlayerStore } from 'src/game/store/playerStore'

export function StaminaBar() {
  const { stamina, isExhausted } = usePlayerStore()

  // Calculate percentage for the bar
  const staminaPercent = Math.max(0, Math.min(100, stamina))

  // Determine color based on stamina level
  let barColor = '#4ade80' // Green
  if (staminaPercent < 30) {
    barColor = '#ef4444' // Red
  } else if (staminaPercent < 60) {
    barColor = '#fbbf24' // Yellow
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '30px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '250px',
        padding: '10px',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        borderRadius: '8px',
        border: '2px solid rgba(255, 255, 255, 0.2)',
        fontFamily: 'monospace',
        color: '#fff',
        userSelect: 'none',
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          fontSize: '12px',
          marginBottom: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>STAMINA</span>
        {isExhausted && (
          <span
            style={{
              color: '#ef4444',
              fontWeight: 'bold',
              fontSize: '11px',
              animation: 'pulse 1s infinite',
            }}
          >
            EXHAUSTED
          </span>
        )}
      </div>

      {/* Stamina bar background */}
      <div
        style={{
          width: '100%',
          height: '20px',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          borderRadius: '4px',
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.3)',
        }}
      >
        {/* Stamina bar fill */}
        <div
          style={{
            width: `${staminaPercent}%`,
            height: '100%',
            backgroundColor: barColor,
            transition: 'width 0.2s ease-out, background-color 0.3s ease',
            boxShadow: `0 0 10px ${barColor}`,
          }}
        />
      </div>

      {/* Stamina value */}
      <div
        style={{
          fontSize: '11px',
          marginTop: '4px',
          textAlign: 'center',
          opacity: 0.8,
        }}
      >
        {Math.round(staminaPercent)}%
      </div>

      {/* Instruction text */}
      <div
        style={{
          fontSize: '10px',
          marginTop: '8px',
          textAlign: 'center',
          opacity: 0.6,
        }}
      >
        Hold SHIFT to run
      </div>

      {/* Pulse animation for exhausted state */}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
    </div>
  )
}
