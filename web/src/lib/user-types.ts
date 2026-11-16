export type Role = 'support' | 'team_lead' | 'admin' | 'other'

export interface EmployeeRow {
  id: string
  full_name: string
  email: string
  role: Role
  job_title: string | null
  is_active: boolean
  created_at: string
  allowed_pages?: string[] | null
}
