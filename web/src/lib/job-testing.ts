export interface JobTestingValues {
  link_plotted: string;
  arm_disarm_schedule: string;
  nvr_count: string;
  ipc_camera_count: string;
  intrusion_panel: string;
  asset_tracker: string;
  jio_tag: string;
  jio_tag_testing: string;
  em_panel: string;
  ai_applied: string;
  other_devices: string;
  broadband_active: string;
  backend_filled: string;
  fr_testing: string;
  ip_panel_testing: string;
}

export const EMPTY_JOB_TESTING_VALUES: JobTestingValues = {
  link_plotted: "",
  arm_disarm_schedule: "",
  nvr_count: "",
  ipc_camera_count: "",
  intrusion_panel: "",
  asset_tracker: "",
  jio_tag: "",
  jio_tag_testing: "",
  em_panel: "",
  ai_applied: "",
  other_devices: "",
  broadband_active: "",
  backend_filled: "",
  fr_testing: "",
  ip_panel_testing: "",
};

export function jobTestingValuesFromRow(
  row: Partial<JobTestingValues> | null | undefined,
): JobTestingValues {
  return {
    link_plotted: row?.link_plotted ?? "",
    arm_disarm_schedule: row?.arm_disarm_schedule ?? "",
    nvr_count: row?.nvr_count ?? "",
    ipc_camera_count: row?.ipc_camera_count ?? "",
    intrusion_panel: row?.intrusion_panel ?? "",
    asset_tracker: row?.asset_tracker ?? "",
    jio_tag: row?.jio_tag ?? "",
    jio_tag_testing: row?.jio_tag_testing ?? "",
    em_panel: row?.em_panel ?? "",
    ai_applied: row?.ai_applied ?? "",
    other_devices: row?.other_devices ?? "",
    broadband_active: row?.broadband_active ?? "",
    backend_filled: row?.backend_filled ?? "",
    fr_testing: row?.fr_testing ?? "",
    ip_panel_testing: row?.ip_panel_testing ?? "",
  };
}

export function jobTestingValuesForSave(
  values: JobTestingValues,
): Record<keyof JobTestingValues, string | null> {
  const optionalValue = (value: string) => value.trim() || null;
  const optionalCustomValue = (value: string) =>
    value === "__other__" || value === "__other_panel__"
      ? null
      : optionalValue(value);
  return {
    link_plotted: optionalValue(values.link_plotted),
    arm_disarm_schedule: optionalValue(values.arm_disarm_schedule),
    nvr_count: optionalCustomValue(values.nvr_count),
    ipc_camera_count: optionalCustomValue(values.ipc_camera_count),
    intrusion_panel: optionalCustomValue(values.intrusion_panel),
    asset_tracker: optionalValue(values.asset_tracker),
    jio_tag: optionalValue(values.jio_tag),
    jio_tag_testing: optionalValue(values.jio_tag_testing),
    em_panel: optionalValue(values.em_panel),
    ai_applied: optionalValue(values.ai_applied),
    other_devices: optionalValue(values.other_devices),
    broadband_active: optionalValue(values.broadband_active),
    backend_filled: optionalValue(values.backend_filled),
    fr_testing: optionalValue(values.fr_testing),
    ip_panel_testing: optionalValue(values.ip_panel_testing),
  };
}
