import {
  availabilityLabel,
  type AvailabilityValue,
} from "../lib/availability";

interface Props {
  status: AvailabilityValue;
  since?: string | null;
  now?: number;
}

export default function AvailabilityIndicator({ status, since, now }: Props) {
  const { label, stale } = availabilityLabel(status, since, now);
  const stateClass = status === "Busy" ? " busy" : " free";
  return (
    <span
      className={`availability-indicator${stateClass}${stale ? " stale" : ""}`}
      role="status"
    >
      {label}
    </span>
  );
}
