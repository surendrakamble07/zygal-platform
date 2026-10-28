import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Engineer, LookupRow, SupportUser } from "./job-types";

const LOOKUP_STALE_MS = 10 * 60 * 1000;

export interface JoinedJobDevice {
  sim_name: string | null
  sim_number: string | null
  link_ip: string | null
  link_mac_id: string | null
  vault_tam: string | null
  cash_counter_tam: string | null
  main_door_tam: string | null
  ngl_main_door_tam: string | null
  device_status: string
  deleted_at: string | null
  created_at: string
}

export interface JoinedJob {
  id: string
  job_no: number
  job_date: string
  call_type: string
  handover_status: string
  final_status: string
  has_minor_issue: boolean
  remark: string | null
  site: {
    id: string
    project_id: string
    branch_code: string
    branch_name: string | null
    state: string | null
    latitude: number | null
    longitude: number | null
    project: { name: string } | null
    project_type: { name: string } | null
    devices?: JoinedJobDevice[] | null
  } | null
  engineer: { full_name: string; phone: string | null } | null
  taken_by: { full_name: string } | null
  material_issues?: { status: string }[] | null
}

export interface JobsSelectOptions {
  includeDevices?: boolean
  includeMaterials?: boolean
}

export function jobsSelect(options: JobsSelectOptions = {}): string {
  const devices = options.includeDevices === false
    ? ''
    : ', devices ( sim_name, sim_number, link_ip, link_mac_id, vault_tam, cash_counter_tam, main_door_tam, ngl_main_door_tam, device_status, deleted_at, created_at )'
  const materials = options.includeMaterials === false ? '' : ', material_issues ( status )'
  return `id, job_no, job_date, call_type, handover_status, final_status, has_minor_issue, remark, site:sites!inner (
    id, project_id, branch_code, branch_name, state, latitude, longitude,
    project:projects!sites_project_id_fkey ( name ),
    project_type:project_types!sites_type_matches_project ( name )
    ${devices}
  ), engineer:engineers ( full_name, phone ), taken_by:profiles!jobs_call_taken_by_fkey ( full_name )
  ${materials}`
}

function useLookup(table: string) {
  return useQuery({
    queryKey: ["lookup", table],
    staleTime: LOOKUP_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("name, sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as LookupRow[];
    },
  });
}

export const useCallTypes = () => useLookup("call_types");
export const useHandoverStatuses = () => useLookup("handover_statuses");
export const useFinalStatuses = () => useLookup("final_statuses");
export const useChecklistItems = () => useLookup("checklist_items");
export const useChecklistResults = () => useLookup("checklist_results");
export const useMaterialItems = () => useLookup("material_items");
export const useMaterialProblems = () => useLookup("material_problems");

export function useEngineers() {
  return useQuery({
    queryKey: ["lookup", "engineers"],
    staleTime: LOOKUP_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("engineers")
        .select("id, full_name, is_active")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Engineer[];
    },
  });
}

export function useSupportUsers() {
  return useQuery({
    queryKey: ["lookup", "support_users"],
    staleTime: LOOKUP_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, is_active")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as SupportUser[];
    },
  });
}

export function useEmployees() {
  return useQuery({
    queryKey: ["lookup", "employees"],
    staleTime: LOOKUP_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, is_active")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as SupportUser[];
    },
  });
}

// Finds a site by its exact branch code, for the Jobs form's "Branch Code" box.
export function useSiteByCode(code: string) {
  const clean = code.trim();
  return useQuery({
    queryKey: ["site-by-code", clean],
    enabled: clean.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select("id, branch_code, branch_name, project_id")
        .eq("branch_code", clean)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
