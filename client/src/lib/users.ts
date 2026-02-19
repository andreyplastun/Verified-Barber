export type UserRole = 'client' | 'specialist' | 'admin'

export interface AppUser {
  id: string
  email: string
  role: UserRole
  specialistId: number | null
  onboardingCompleted: boolean
  onboardingSeenClient: boolean
  onboardingSeenPro: boolean
  createdAt: string
}

export async function getUserRole(userId: string): Promise<UserRole> {
  try {
    const res = await fetch(`/api/users/${userId}`)
    if (!res.ok) return 'client'
    
    const data = await res.json()
    return data.role as UserRole
  } catch (err) {
    console.error('Failed to get user role:', err)
    return 'client'
  }
}

export async function isSpecialist(userId: string): Promise<boolean> {
  const role = await getUserRole(userId)
  return role === 'specialist'
}

export async function getAppUser(userId: string): Promise<AppUser | null> {
  try {
    const res = await fetch(`/api/users/${userId}`)
    if (!res.ok) return null
    
    const data = await res.json()
    return {
      id: data.id,
      email: data.email,
      role: data.role as UserRole,
      specialistId: data.specialistId,
      onboardingCompleted: data.onboardingCompleted ?? false,
      onboardingSeenClient: data.onboardingSeenClient ?? false,
      onboardingSeenPro: data.onboardingSeenPro ?? false,
      createdAt: data.createdAt,
    }
  } catch (err) {
    console.error('Failed to get user:', err)
    return null
  }
}

export async function updateUserRole(userId: string, role: UserRole, specialistId?: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/users/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, specialistId }),
    })
    
    return res.ok
  } catch (err) {
    console.error('Failed to update user role:', err)
    return false
  }
}
