'use server'

import { AuthError } from 'next-auth'

import { signIn } from 'src/auth'

export async function sendMagicLink(
  formData: FormData,
): Promise<{ success: true } | { success: false; error: string }> {
  const email = formData.get('email')

  if (!email || typeof email !== 'string') {
    return { success: false, error: 'Please enter a valid email address.' }
  }

  try {
    await signIn('nodemailer', {
      email,
      redirect: false,
      callbackUrl: '/',
    })

    return { success: true }
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        success: false,
        error: 'Unable to send magic link. Please try again.',
      }
    }

    throw error
  }
}
