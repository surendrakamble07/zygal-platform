export interface Project {
  id: string;
  name: string;
  is_active: boolean;
}

export interface ProjectType {
  id: string;
  project_id: string;
  name: string;
  is_active: boolean;
}

export interface StateRow {
  name: string;
}

export interface Site {
  id: string;
  project_id: string;
  project_type_id: string;
  branch_code: string;
  branch_name: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  status: "Active" | "Inactive";
}
