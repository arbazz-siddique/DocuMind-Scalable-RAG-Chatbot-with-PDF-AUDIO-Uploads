'use client'
import { useAuth } from '@clerk/nextjs'
import { toast } from 'sonner'

export const useAuthToast = () => {
  const { isSignedIn } = useAuth()

  const checkAuth = (action: string): boolean => {
    if (!isSignedIn) {
      toast.error('Authentication Required', {
        description: `Please sign in to ${action}`,
        duration: 4000,
        action: {
          label: 'Sign In',
          onClick: () => {
            // This will trigger the sign-in flow
            const signInEvent = new Event('triggerSignIn');
            window.dispatchEvent(signInEvent);
          }
        },
      })
      return false
    }
    return true
  }

  const showAuthToast = (action: string) => {
    toast.warning('Login Required', {
      description: `Please login or sign up to ${action}`,
      duration: 5000,
      action: {
        label: 'Sign In',
        onClick: () => {
          // This will trigger the sign-in flow
          const signInEvent = new Event('triggerSignIn');
          window.dispatchEvent(signInEvent);
        }
      },
    })
  }

  return { checkAuth, showAuthToast, isSignedIn }
}