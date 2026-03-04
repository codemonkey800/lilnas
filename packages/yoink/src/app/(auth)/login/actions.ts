'use server'

import { signIn, signOut } from 'src/auth'

export async function signInWithGoogle(returnTo?: string) {
  const redirectTo = returnTo && returnTo.startsWith('/') ? returnTo : '/'

  await signIn('google', { redirectTo })
}

export async function signOutAction() {
  await signOut({ redirectTo: '/login' })
}
