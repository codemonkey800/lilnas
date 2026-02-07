import { LoginForm } from './login-form'

export const metadata = {
  title: 'Sign in — Sync',
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <LoginForm />
    </main>
  )
}
