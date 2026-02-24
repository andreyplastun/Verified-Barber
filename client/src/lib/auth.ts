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
  await supabase.auth.signOut()
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith("sb-") || key.startsWith("supabase"))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
  sessionStorage.clear()
  document.cookie.split(";").forEach((c) => {
    document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
  });
}

export async function forceLogout() {
  await signOut()
  window.location.reload()
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function getCurrentUserWithRole(): Promise<{ 
  id: string; 
  email: string; 
  role: 'client' | 'specialist' | 'admin';
  specialistId: number | null;
  onboardingCompleted: boolean;
  onboardingSeenClient: boolean;
  onboardingSeenPro: boolean;
  createdAt: string | null;
} | null> {
  const { data: { user } } = await supabase.auth.getUser()
  
  console.log('[AUTH] Supabase user:', user?.id, user?.email)
  
  if (!user) {
    console.log('[AUTH] No Supabase user found')
    return null
  }

  try {
    console.log('[AUTH] Fetching role from /api/users/' + user.id)
    const res = await fetch(`/api/users/${user.id}`)
    console.log('[AUTH] API response status:', res.status)
    
    if (!res.ok) {
      console.error('[AUTH] API error:', res.status, res.statusText)
      return null
    }
    
    const data = await res.json()
    console.log('[AUTH] User data from API:', data)
    
    return {
      id: data.id,
      email: data.email,
      role: data.role as 'client' | 'specialist' | 'admin',
      specialistId: data.specialistId ?? null,
      onboardingCompleted: data.onboardingCompleted ?? false,
      onboardingSeenClient: data.onboardingSeenClient ?? false,
      onboardingSeenPro: data.onboardingSeenPro ?? false,
      createdAt: data.createdAt ?? null,
    }
  } catch (err) {
    console.error('[AUTH] Failed to get user with role:', err)
    return null
  }
}

export function onAuthStateChange(callback: (user: any) => void) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user || null)
  })
}
