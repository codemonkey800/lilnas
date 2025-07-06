import { z } from 'zod'

import { runInteractive } from 'src/utils'

const SyncPhotosOptionsSchema = z.object({
  dest: z.string().min(1),
  email: z.string().min(1),
})

export async function syncPhotos(payload: unknown) {
  const options = SyncPhotosOptionsSchema.parse(payload)

  await runInteractive(
    `docker run \\
      -it --rm \\
      --name icloudpd \\
      -v ${options.dest}:/icloud \\
      -e TZ=America/Los_Angeles \\
      icloudpd/icloudpd \\
      icloudpd --directory /icloud --username ${options.email}`,
  )
}
