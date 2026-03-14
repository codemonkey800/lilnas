export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3 border-b border-carbon-700 pb-2.5">
      <h2 className="font-mono text-sm font-semibold uppercase tracking-widest text-carbon-300">
        {children}
      </h2>
    </div>
  )
}
