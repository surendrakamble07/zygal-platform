import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Project, ProjectType, StateRow } from "./types";

// Small lookup lists. Loaded once, then reused from the cache for 10 minutes.
const LOOKUP_STALE_MS = 10 * 60 * 1000;

export function useProjects() {
  return useQuery({
    queryKey: ["lookup", "projects"],
    staleTime: LOOKUP_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, is_active")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });
}

export function useProjectTypes() {
  return useQuery({
    queryKey: ["lookup", "project_types"],
    staleTime: LOOKUP_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_types")
        .select("id, project_id, name, is_active")
        .order("name");
      if (error) throw error;
      return (data ?? []) as ProjectType[];
    },
  });
}

export function useStates() {
  return useQuery({
    queryKey: ["lookup", "states"],
    staleTime: LOOKUP_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("states")
        .select("name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as StateRow[];
    },
  });
}
