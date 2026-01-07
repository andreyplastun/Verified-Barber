import { supabase } from './supabase'

export type UserRole = 'client' | 'specialist'

export interface AppUser {
  id: string
  email: string
  role: UserRole
  specialistId: number | null
  createdAt: string
}

export async function getUserRole(userId: string): Promise<UserRole> {
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !data) {
    console.error('Failed to get user role:', error)
    return 'client'
  }

  return data.role as UserRole
}

export async function isSpecialist(userId: string): Promise<boolean> {
  const role = await getUserRole(userId)
  return role === 'specialist'
}

export async function getAppUser(userId: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (error || !data) {
    console.error('Failed to get user:', error)
    return null
  }

  return {
    id: data.id,
    email: data.email,
    role: data.role as UserRole,
    specialistId: data.specialist_id,
    createdAt: data.created_at,
  }
}

export async function updateUserRole(userId: string, role: UserRole, specialistId?: number): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({ 
      role, 
      specialist_id: specialistId || null 
    })
    .eq('id', userId)

  if (error) {
    console.error('Failed to update user role:', error)
    return false
  }

  return true
}
