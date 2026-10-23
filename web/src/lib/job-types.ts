export interface LookupRow {
  name: string
  sort_order: number
}

export interface Engineer {
  id: string
  full_name: string
  is_active: boolean
}

export interface SupportUser {
  id: string
  full_name: string
  is_active: boolean
}

export interface SiteLite {
  id: string
  branch_code: string
  branch_name: string | null
  project_id: string
}

export interface Job {
  id: string
  job_no: number
  job_date: string
  call_type: string
  site_id: string
  call_taken_by: string
  engineer_id: string | null
  handover_status: string
  final_status: string
  has_minor_issue: boolean
  remark: string | null
  completed_at: string | null
}

export interface ChecklistLine {
  id: string
  job_id: string
  item: string
  result: string
  remark: string | null
}

export interface MaterialLine {
  id: string
  job_id: string
  item: string
  problem: string
  quantity: number
  status: string
  remark: string | null
}
