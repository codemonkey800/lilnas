export function Home() {
  return (
    <div className="flex flex-auto items-center justify-center h-full w-full">
      <div className="flex flex-col gap-2 text-center items-center">
        <img
          className="rounded-full bg-purple-800 overflow-hidden border-[10px] border-purple-500"
          src="/sad-pepe.png"
          width={250}
        />

        <p className="text-5xl font-bold">TDR Bot</p>
        <p className="text-xl">for the bois</p>
      </div>
    </div>
  )
}
