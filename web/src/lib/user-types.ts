export type Role = 'support' | 'team_lead' | 'admin' | 'other'

export interface EmployeeRow {
  id: string
  full_name: string
  email: string
  phone: string | null
  role: Role
  job_title: string | null
  is_active: boolean
  is_dummy: boolean
  created_at: string
  allowed_pages?: string[] | null
}
