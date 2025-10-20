import { SadPepeIcon } from './SadPepeIcon'

export function Home() {
  return (
    <div className="flex flex-auto items-center justify-center h-full w-full">
      <div className="flex flex-col gap-2 text-center items-center">
        <div className="rounded-full bg-purple-800 overflow-hidden border-10 border-purple-500">
          <SadPepeIcon />
        </div>

        <p className="text-5xl font-bold">TDR Bot</p>
        <p className="text-xl">for the bois</p>
      </div>
    </div>
  )
}
