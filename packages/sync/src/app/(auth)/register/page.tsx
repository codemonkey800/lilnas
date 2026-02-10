import { RegisterForm } from './register-form'

export const metadata = {
  title: 'Create account — Sync',
}

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <RegisterForm />
    </main>
  )
}
