import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/auth-context";
import {
  useCallTypes,
  useEngineers,
  useHandoverStatuses,
  useSiteByCode,
  useSupportUsers,
} from "../lib/job-queries";
import { friendlyJobError } from "../lib/job-errors";
import type { Job } from "../lib/job-types";

interface Props {
  job: Job | null; // null = adding a new job
  onClose: () => void;
  onSaved?: (jobId: string) => void; // called after a new job is created, to open its detail screen
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function JobForm({ job, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const callTypes = useCallTypes();
  const handoverStatuses = useHandoverStatuses();
  const engineers = useEngineers();
  const support = useSupportUsers();
  const [jobDate, setJobDate] = useState(job?.job_date ?? todayStr());
  const [callType, setCallType] = useState(job?.call_type ?? "");
  const [branchCode, setBranchCode] = useState("");
  const [callTakenBy, setCallTakenBy] = useState(
    job?.call_taken_by ?? profile?.id ?? "",
  );
  const [engineerId, setEngineerId] = useState(job?.engineer_id ?? "");
  const [handoverStatus, setHandoverStatus] = useState(
    job?.handover_status ?? "Pending",
  );
  const [remark, setRemark] = useState(job?.remark ?? "");
  const [error, setError] = useState("");

  // Editing an existing job: show its branch code once we know it.

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    supabase
      .from("sites")
      .select("branch_code")
      .eq("id", job.site_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setBranchCode(data.branch_code);
      });
    return () => {
      cancelled = true;
    };
  }, [job]);

  const lookupCode = useSiteByCode(branchCode);
  const siteId = lookupCode.data?.id ?? "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (job) {
        const { error: dbError } = await supabase
          .from("jobs")
          .update(payload)
          .eq("id", job.id);
        if (dbError) throw dbError;
        return job.id;
      }
      const { data, error: dbError } = await supabase
        .from("jobs")
        .insert(payload)
        .select("id")
        .single();
      if (dbError) throw dbError;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      if (!job) onSaved?.(id);
      onClose();
    },
    onError: (err) => setError(friendlyJobError(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    setError("");

    if (!jobDate) return setError("Pick the job date.");
    if (!callType) return setError("Choose a call type.");
    if (!branchCode.trim()) return setError("Enter the Branch Code.");
    if (!siteId)
      return setError(
        "No site found for this Branch Code. Add the site first, under Sites.",
      );
    if (!callTakenBy) return setError("Choose who took the call.");

    save.mutate({
      job_date: jobDate,
      call_type: callType,
      site_id: siteId,
      call_taken_by: callTakenBy,
      engineer_id: engineerId || null,
      handover_status: job ? undefined : handoverStatus,
      remark: remark.trim() || null,
    });
  }

  const loading =
    callTypes.isLoading ||
    handoverStatuses.isLoading ||
    engineers.isLoading ||
    support.isLoading;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={job ? "Edit job" : "New job"}
      >
        <h2>{job ? `Edit Job #${job.job_no}` : "New job"}</h2>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : (
          <form onSubmit={submit} noValidate className="grid-form">
            <label>
              Date
              <input
                type="date"
                value={jobDate}
                onChange={(e) => setJobDate(e.target.value)}
              />
            </label>

            <label>
              Call type
              <select
                value={callType}
                onChange={(e) => setCallType(e.target.value)}
              >
                <option value="">Select call type</option>
                {callTypes.data?.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Branch code
              <input
                value={branchCode}
                onChange={(e) => setBranchCode(e.target.value)}
                placeholder="e.g. 740_Bangarapete"
              />
              {branchCode.trim() && !lookupCode.isFetching && (
                <span className={siteId ? "hint ok" : "hint bad"}>
                  {siteId
                    ? `Found: ${lookupCode.data?.branch_name ?? "site"}`
                    : "Not found. Add this site under Sites first."}
                </span>
              )}
            </label>

            <label>
              Call taken by
              <select
                value={callTakenBy}
                onChange={(e) => setCallTakenBy(e.target.value)}
              >
                <option value="">Select person</option>
                {support.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Engineer
              <select
                value={engineerId}
                onChange={(e) => setEngineerId(e.target.value)}
              >
                <option value="">Not assigned yet</option>
                {engineers.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </label>

            {!job && (
              <label>
                Handover status
                <select
                  value={handoverStatus}
                  onChange={(e) => setHandoverStatus(e.target.value)}
                >
                  {handoverStatuses.data?.map((h) => (
                    <option key={h.name} value={h.name}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="full">
              Remark
              <textarea
                rows={3}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </label>

            {error && <div className="banner error full">{error}</div>}

            <div className="actions full">
              <button
                type="button"
                className="secondary"
                onClick={onClose}
                disabled={save.isPending}
              >
                Cancel
              </button>
              <button type="submit" disabled={save.isPending}>
                {save.isPending
                  ? "Saving..."
                  : job
                    ? "Save changes"
                    : "Create job"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
