import type { JobTestingValues } from "../lib/job-testing";

interface Props {
  values: JobTestingValues;
  onChange: (patch: Partial<JobTestingValues>) => void;
}

const YES_NO = ["Yes", "No"];
const YES_NO_NA = ["Yes", "No", "NA"];
const COUNTS = ["1", "2", "3", "4"];

function ChoiceField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="field-caption">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function CustomValueField({
  label,
  value,
  options,
  otherValue,
  otherLabel,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  otherValue: string;
  otherLabel: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const isCustomValue =
    value !== "" && value !== otherValue && !options.includes(value);
  const isOtherSelected = value === otherValue || isCustomValue;

  return (
    <label>
      <span className="field-caption">{label}</span>
      <select
        value={isOtherSelected ? otherValue : value}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue === otherValue ? otherValue : nextValue);
        }}
      >
        <option value="">Select</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={otherValue}>{otherLabel}</option>
      </select>
      {isOtherSelected && (
        <input
          value={value === otherValue ? "" : value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}

export default function JobTestingFields({ values, onChange }: Props) {
  return (
    <div className="grid-form">
      <ChoiceField
        label="Link Plotted"
        value={values.link_plotted}
        options={YES_NO}
        onChange={(value) => onChange({ link_plotted: value })}
      />
      <ChoiceField
        label="ARM-DISARM Schedule"
        value={values.arm_disarm_schedule}
        options={YES_NO_NA}
        onChange={(value) => onChange({ arm_disarm_schedule: value })}
      />
      <CustomValueField
        label="NVR"
        value={values.nvr_count}
        options={COUNTS}
        otherValue="__other__"
        otherLabel="Other (type manually)"
        placeholder="Enter NVR count"
        onChange={(value) => onChange({ nvr_count: value })}
      />
      <CustomValueField
        label="IPC Vault Room Cameras"
        value={values.ipc_camera_count}
        options={COUNTS}
        otherValue="__other__"
        otherLabel="Other (type manually)"
        placeholder="Enter camera count"
        onChange={(value) => onChange({ ipc_camera_count: value })}
      />
      <CustomValueField
        label="Intrusion Panel (IP Panel)"
        value={values.intrusion_panel}
        options={YES_NO}
        otherValue="__other_panel__"
        otherLabel="Other panel (type name)"
        placeholder="Enter panel name"
        onChange={(value) => onChange({ intrusion_panel: value })}
      />
      <ChoiceField
        label="Asset Tracker"
        value={values.asset_tracker}
        options={YES_NO_NA}
        onChange={(value) => onChange({ asset_tracker: value })}
      />
      <ChoiceField
        label="Jio Tag"
        value={values.jio_tag}
        options={YES_NO_NA}
        onChange={(value) => onChange({ jio_tag: value })}
      />
      <ChoiceField
        label="Jio Tag Testing"
        value={values.jio_tag_testing}
        options={YES_NO_NA}
        onChange={(value) => onChange({ jio_tag_testing: value })}
      />
      <ChoiceField
        label="EM Panel"
        value={values.em_panel}
        options={YES_NO_NA}
        onChange={(value) => onChange({ em_panel: value })}
      />
      <ChoiceField
        label="AI Applied"
        value={values.ai_applied}
        options={YES_NO_NA}
        onChange={(value) => onChange({ ai_applied: value })}
      />
      <label>
        <span className="field-caption">Other Devices</span>
        <input
          value={values.other_devices}
          onChange={(event) => onChange({ other_devices: event.target.value })}
        />
      </label>
      <ChoiceField
        label="Broadband Active"
        value={values.broadband_active}
        options={YES_NO_NA}
        onChange={(value) => onChange({ broadband_active: value })}
      />
      <ChoiceField
        label="Backend Filled"
        value={values.backend_filled}
        options={YES_NO_NA}
        onChange={(value) => onChange({ backend_filled: value })}
      />
      <ChoiceField
        label="FR Testing"
        value={values.fr_testing}
        options={YES_NO_NA}
        onChange={(value) => onChange({ fr_testing: value })}
      />
      <ChoiceField
        label="IP Panel Testing"
        value={values.ip_panel_testing}
        options={YES_NO_NA}
        onChange={(value) => onChange({ ip_panel_testing: value })}
      />
    </div>
  );
}
