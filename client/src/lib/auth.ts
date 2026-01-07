import { supabase } from './supabase'

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: undefined,
    },
  })

  if (error) throw error

  if (data.user) {
    // Create user record via backend API
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: data.user.id,
          email: data.user.email,
          role: 'client',
        }),
      })
      
      if (!res.ok) {
        const err = await res.json()
        console.error('Failed to create user record:', err)
      }
    } catch (err) {
      console.error('Failed to create user record:', err)
    }

    // Auto sign-in after signup (bypass email confirmation)
    if (!data.session) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) {
        console.warn('Auto sign-in after signup failed:', signInError.message)
      }
    }
  }

  return data
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw error

  if (data.user) {
    // Ensure user record exists in backend (may have been created via signup)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: data.user.id,
          email: data.user.email,
        }),
      })
      
      if (!res.ok) {
        const err = await res.json()
        console.error('Failed to ensure user record:', err)
      }
    } catch (err) {
      console.error('Failed to ensure user record:', err)
    }
  }

  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function getCurrentUserWithRole(): Promise<{ id: string; email: string; role: 'client' | 'specialist' } | null> {
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return null

  try {
    const res = await fetch(`/api/users/${user.id}`)
    if (!res.ok) return null
    
    const data = await res.json()
    return {
      id: data.id,
      email: data.email,
      role: data.role as 'client' | 'specialist',
    }
  } catch (err) {
    console.error('Failed to get user with role:', err)
    return null
  }
}

export function onAuthStateChange(callback: (user: any) => void) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user || null)
  })
}
