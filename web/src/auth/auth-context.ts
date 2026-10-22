import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export type Role = 'support' | 'team_lead' | 'admin'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: Role
  job_title: string | null
  is_active: boolean
}

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in'

export interface ActionResult {
  ok: boolean
  message?: string
}

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  profile: Profile | null
  notice: string | null
  requestCode: (email: string) => Promise<ActionResult>
  verifyCode: (email: string, code: string) => Promise<ActionResult>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
