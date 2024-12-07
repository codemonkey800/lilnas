import { getAppHosts } from 'src/utils/hosts'

export async function AppList() {
  const hosts = await getAppHosts()

  return (
    <div className="flex flex-col flex-auto items-center justify-center bg-gray-900 text-white">
      <p className="text-6xl mb-12 font-bold">lilnas apps</p>

      <div className="flex flex-col gap-2">
        {hosts.map(host => (
          <a
            className="text-4xl text-center underline text-purple-500"
            target="_blank"
            rel="noreferrer noopener"
            key={host}
            href={`https://${host}`}
          >
            {host}
          </a>
        ))}
      </div>
    </div>
  )
}
