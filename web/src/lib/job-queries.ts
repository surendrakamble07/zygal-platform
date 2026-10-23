import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Engineer, LookupRow, SupportUser } from "./job-types";

const LOOKUP_STALE_MS = 10 * 60 * 1000;

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
