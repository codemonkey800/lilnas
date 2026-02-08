'use server'

import { AuthError } from 'next-auth'

import { signIn } from 'src/auth'

export async function loginWithCredentials(
  formData: FormData,
): Promise<{ success: true } | { success: false; error: string }> {
  const email = formData.get('email')
  const password = formData.get('password')

  if (!email || typeof email !== 'string') {
    return { success: false, error: 'Please enter a valid email address.' }
  }

  if (!password || typeof password !== 'string') {
    return { success: false, error: 'Please enter your password.' }
  }

  try {
    await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    return { success: true }
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        success: false,
        error: 'Invalid email or password.',
      }
    }

    throw error
  }
}
