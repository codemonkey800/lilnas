'use server'

import { signIn, signOut } from 'src/auth'

export async function signInWithGoogle() {
  await signIn('google', { redirectTo: '/' })
}

export async function signOutAction() {
  await signOut({ redirectTo: '/login' })
}
