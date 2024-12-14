import 'src/tailwind.css'

import { Layout } from 'src/components/Layout'
import Providers from 'src/components/Provider'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html className="w-full h-full" lang="en">
      <body className="w-full h-full flex flex-auto flex-col">
        <Providers>
          <Layout>{children}</Layout>
        </Providers>
      </body>
    </html>
  )
}
