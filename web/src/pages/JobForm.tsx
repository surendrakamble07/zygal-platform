import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/auth-context";
import {
  useCallTypes,
  useFinalStatuses,
  useHandoverStatuses,
  useMaterialItems,
  useMaterialProblems,
  useSiteByCode,
  useSupportUsers,
} from "../lib/job-queries";
import { useDevicesForSite } from "../lib/device-queries";
import { useProjects, useProjectTypes, useStates } from "../lib/queries";
import { friendlyJobError } from "../lib/job-errors";
import type { Device } from "../lib/device-types";
import type { Job } from "../lib/job-types";

interface Props {
  job: Job | null;
  onClose: () => void;
  onSaved?: (jobId: string) => void;
}

interface SiteDetails {
  id: string;
  project_id: string;
  project_type_id: string;
  branch_name: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface SiteDraft {
  siteId: string;
  projectId: string;
  projectTypeId: string;
  branchName: string;
  stateName: string;
  latitude: string;
  longitude: string;
}

interface DeviceDraft {
  siteId: string;
  deviceId: string;
  fields: DeviceFields;
}

interface EngineerOption {
  id: string;
  full_name: string;
  phone: string | null;
  is_active: boolean;
}

interface DeviceFields {
  sim_name: string;
  sim_number: string;
  link_ip: string;
  link_mac_id: string;
  vault_tam: string;
  cash_counter_tam: string;
  main_door_tam: string;
  ngl_main_door_tam: string;
}

interface MaterialDraft {
  item: string;
  problem: string;
  quantity: string;
  status: "Pending" | "Resolved";
}

class JobFormValidationError extends Error {}

const NEW_DEVICE = "__new_device__";
const SIM_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const SIM_PHOTO_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};
const todayStr = () => new Date().toISOString().slice(0, 10);
function simPhotoExtension(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const expectedType = SIM_PHOTO_TYPES[extension];
  if (!expectedType || (file.type && file.type !== expectedType)) return null;
  return extension;
}

function coordinateValue(text: string): number | null {
  const clean = text.trim();
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : Number.NaN;
}

function deviceValues(device?: Device) {
  return {
    sim_name: device?.sim_name ?? "",
    sim_number: device?.sim_number ?? "",
    link_ip: device?.link_ip ?? "",
    link_mac_id: device?.link_mac_id ?? "",
    vault_tam: device?.vault_tam ?? "",
    cash_counter_tam: device?.cash_counter_tam ?? "",
    main_door_tam: device?.main_door_tam ?? "",
    ngl_main_door_tam: device?.ngl_main_door_tam ?? "",
  };
}

function friendlySaveError(err: unknown): string {
  if (err instanceof JobFormValidationError) return err.message;
  if (
    err instanceof Error &&
    (err.message.startsWith("Job saved, but") ||
      err.message.startsWith("Job saved and the photo uploaded"))
  )
    return err.message;
  return friendlyJobError(err);
}

export default function JobForm({ job, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const callTypes = useCallTypes();
  const handoverStatuses = useHandoverStatuses();
  const finalStatuses = useFinalStatuses();
  const materialItems = useMaterialItems();
  const materialProblems = useMaterialProblems();
  const support = useSupportUsers();
  const projects = useProjects();
  const projectTypes = useProjectTypes();
  const states = useStates();
  const engineers = useQuery({
    queryKey: ["job-form-engineers"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("engineers")
        .select("id, full_name, phone, is_active")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as EngineerOption[];
    },
  });

  const [jobDate, setJobDate] = useState(job?.job_date ?? todayStr());
  const [callType, setCallType] = useState(job?.call_type ?? "");
  const [branchCode, setBranchCode] = useState("");
  const [callTakenBy, setCallTakenBy] = useState(
    job?.call_taken_by ?? profile?.id ?? "",
  );
  const [engineerNameDraft, setEngineerNameDraft] = useState<string | null>(null);
  const [engineerNumberDraft, setEngineerNumberDraft] = useState<string | null>(null);
  const [handoverStatus, setHandoverStatus] = useState(
    job?.handover_status ?? "Pending",
  );
  const [finalStatus, setFinalStatus] = useState(job?.final_status ?? "WIP");
  const [hasMinorIssue, setHasMinorIssue] = useState(
    job?.has_minor_issue ?? false,
  );
  const [remark, setRemark] = useState(job?.remark ?? "");
  const [siteDraft, setSiteDraft] = useState<SiteDraft | null>(null);
  const [deviceDraft, setDeviceDraft] = useState<DeviceDraft | null>(null);
  const [persistedDeviceId, setPersistedDeviceId] = useState<string | null>(
    null,
  );
  const [simPhotoFile, setSimPhotoFile] = useState<File | null>(null);
  const [simPhotoError, setSimPhotoError] = useState("");
  const [uploadingSimPhoto, setUploadingSimPhoto] = useState(false);
  const simPhotoInputRef = useRef<HTMLInputElement>(null);
  const [materialDrafts, setMaterialDrafts] = useState<MaterialDraft[]>([]);
  const [error, setError] = useState("");
  const [persistedJobId, setPersistedJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    supabase
      .from("sites")
      .select("branch_code")
      .eq("id", job.site_id)
      .maybeSingle()
      .then(({ data, error: lookupError }) => {
        if (lookupError) {
          setError(
            "Could not load the job's site. Please close and reopen the form.",
          );
          return;
        }
        if (!cancelled && data) setBranchCode(data.branch_code);
      });
    return () => {
      cancelled = true;
    };
  }, [job]);

  const lookupCode = useSiteByCode(branchCode);
  const siteId = lookupCode.data?.id ?? "";
  const siteDetails = useQuery({
    queryKey: ["job-form-site-details", siteId],
    enabled: !!siteId,
    queryFn: async () => {
      if (!siteId) throw new Error("A site must be selected.");
      const { data, error: dbError } = await supabase
        .from("sites")
        .select(
          "id, project_id, project_type_id, branch_name, state, latitude, longitude",
        )
        .eq("id", siteId)
        .single();
      if (dbError) throw dbError;
      return data as SiteDetails;
    },
  });
  const devices = useDevicesForSite(siteId || undefined);
  const assignedEngineer = engineers.data?.find(
    (engineer) => engineer.id === job?.engineer_id,
  );
  const engineerName = engineerNameDraft ?? assignedEngineer?.full_name ?? "";
  const matchingEngineer = engineers.data?.find(
    (engineer) =>
      engineer.full_name.trim().toLocaleLowerCase()
      === engineerName.trim().toLocaleLowerCase(),
  );
  const engineerNumber = engineerNumberDraft
    ?? (matchingEngineer
      ? matchingEngineer.phone ?? ""
      : engineerNameDraft === null
        ? assignedEngineer?.phone ?? ""
        : "");
  const activeDevices = (devices.data ?? []).filter(
    (device) => device.device_status === "Active",
  );
  const siteReady =
    !!siteId && siteDetails.data?.id === siteId && !siteDetails.isLoading;
  const loadedSite = siteDetails.data?.id === siteId ? siteDetails.data : null;
  const siteValues =
    siteDraft?.siteId === siteId
      ? siteDraft
      : loadedSite
        ? {
            siteId,
            projectId: loadedSite.project_id,
            projectTypeId: loadedSite.project_type_id,
            branchName: loadedSite.branch_name ?? "",
            stateName: loadedSite.state ?? "",
            latitude:
              loadedSite.latitude == null ? "" : String(loadedSite.latitude),
            longitude:
              loadedSite.longitude == null ? "" : String(loadedSite.longitude),
          }
        : null;
  const defaultDevice =
    activeDevices.length === 1 ? activeDevices[0] : undefined;
  const defaultDeviceId =
    defaultDevice?.id ?? (activeDevices.length === 0 ? NEW_DEVICE : "");
  const currentDeviceDraft =
    deviceDraft && deviceDraft.siteId === siteId ? deviceDraft : null;
  const selectedDeviceId = currentDeviceDraft
    ? currentDeviceDraft.deviceId
    : defaultDeviceId;
  const deviceFields = currentDeviceDraft
    ? currentDeviceDraft.fields
    : deviceValues(defaultDevice);
  const selectedDevice = activeDevices.find(
    (device) => device.id === selectedDeviceId,
  );
  const simPhotoPreview = useMemo(
    () => simPhotoFile ? URL.createObjectURL(simPhotoFile) : null,
    [simPhotoFile],
  );
  useEffect(() => {
    return () => {
      if (simPhotoPreview) URL.revokeObjectURL(simPhotoPreview);
    };
  }, [simPhotoPreview]);
  const selectedPhotoPath = selectedDevice?.sim_photo_path ?? null;
  const selectedPhoto = useQuery({
    queryKey: ["job-form-sim-photo", selectedPhotoPath],
    enabled: !!selectedPhotoPath && !simPhotoFile,
    queryFn: async () => {
      if (!selectedPhotoPath) throw new Error("No SIM photo is selected.");
      const { data, error: storageError } = await supabase.storage
        .from("sim-photos")
        .createSignedUrl(selectedPhotoPath, 3600);
      if (storageError) throw storageError;
      return data.signedUrl;
    },
  });
  const simPhotoUrl = simPhotoPreview ?? selectedPhoto.data ?? null;

  function updateSiteDraft(patch: Partial<Omit<SiteDraft, "siteId">>) {
    if (!loadedSite) return;
    setSiteDraft((current) => ({
      siteId,
      projectId:
        current && current.siteId === siteId
          ? current.projectId
          : loadedSite.project_id,
      projectTypeId:
        current && current.siteId === siteId
          ? current.projectTypeId
          : loadedSite.project_type_id,
      branchName:
        current && current.siteId === siteId
          ? current.branchName
          : (loadedSite.branch_name ?? ""),
      stateName:
        current && current.siteId === siteId
          ? current.stateName
          : (loadedSite.state ?? ""),
      latitude:
        current && current.siteId === siteId
          ? current.latitude
          : loadedSite.latitude == null
            ? ""
            : String(loadedSite.latitude),
      longitude:
        current && current.siteId === siteId
          ? current.longitude
          : loadedSite.longitude == null
            ? ""
            : String(loadedSite.longitude),
      ...patch,
    }));
  }

  function chooseDevice(deviceId: string) {
    const selected = activeDevices.find((device) => device.id === deviceId);
    setDeviceDraft({ siteId, deviceId, fields: deviceValues(selected) });
    setSimPhotoFile(null);
    setSimPhotoError("");
  }

  function chooseSimPhoto(file: File | null) {
    setSimPhotoError("");
    if (!file) {
      setSimPhotoFile(null);
      return;
    }
    if (file.size > SIM_PHOTO_MAX_BYTES) {
      setSimPhotoFile(null);
      setSimPhotoError("SIM photo must be 5 MB or smaller.");
      return;
    }
    if (!simPhotoExtension(file)) {
      setSimPhotoFile(null);
      setSimPhotoError("Choose a JPG, PNG, WebP, or HEIC image.");
      return;
    }
    setSimPhotoFile(file);
  }

  function updateDeviceField<K extends keyof DeviceFields>(
    key: K,
    value: string,
  ) {
    setDeviceDraft({
      siteId,
      deviceId: selectedDeviceId,
      fields: { ...deviceFields, [key]: value },
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: async () => {
      if (!siteId || !siteDetails.data || siteDetails.data.id !== siteId) {
        throw new JobFormValidationError(
          "Wait for the selected site's details to finish loading.",
        );
      }

      if (!siteValues)
        throw new Error(
          "Wait for the selected site's details to finish loading.",
        );
      const lat = coordinateValue(siteValues.latitude);
      const lng = coordinateValue(siteValues.longitude);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        throw new JobFormValidationError(
          "Latitude and longitude must be numbers.",
        );
      }
      if ((lat === null) !== (lng === null)) {
        throw new JobFormValidationError(
          "Enter both latitude and longitude, or leave both empty.",
        );
      }
      if (lat !== null && (lat < 6 || lat > 38)) {
        throw new JobFormValidationError(
          "Latitude must be between 6 and 38 (India).",
        );
      }
      if (lng !== null && (lng < 68 || lng > 98)) {
        throw new JobFormValidationError(
          "Longitude must be between 68 and 98 (India).",
        );
      }

      const pendingMaterialCount = materialDrafts.filter(
        (material) =>
          material.item && material.problem && material.status === "Pending",
      ).length;
      const closesJob = finalStatus === "Completed" || finalStatus === "Live";
      if (closesJob && handoverStatus === "Pending") {
        throw new JobFormValidationError(
          "A job cannot be Completed or Live while Handover is Pending.",
        );
      }
      if (closesJob && pendingMaterialCount > 0) {
        throw new JobFormValidationError(
          "A job cannot be Completed or Live while a material issue is Pending.",
        );
      }

      const existingDeviceId =
        selectedDevice?.id ??
        (selectedDeviceId === persistedDeviceId ? persistedDeviceId : null);
      const cleanDevice = Object.fromEntries(
        Object.entries(deviceFields).map(([key, value]) => [
          key,
          value.trim() || null,
        ]),
      );
      const hasDeviceValues = Object.values(deviceFields).some(
        (value) => value.trim() !== "",
      );
      if (
        selectedDeviceId &&
        selectedDeviceId !== NEW_DEVICE &&
        !existingDeviceId
      ) {
        throw new JobFormValidationError(
          "Choose an active device for this site.",
        );
      }
      const simNumber = deviceFields.sim_number.trim();
      if (hasDeviceValues && simNumber && !/^[0-9]{18,22}$/.test(simNumber)) {
        throw new JobFormValidationError(
          "SIM number must be 18 to 22 digits, with no spaces or symbols.",
        );
      }

      const cleanEngineerName = engineerName.trim();
      const cleanEngineerNumber = engineerNumber.trim();
      if (!cleanEngineerName && cleanEngineerNumber) {
        throw new JobFormValidationError(
          "Enter the engineer's name when providing an engineer number.",
        );
      }

      let savedEngineerId: string | null = null;
      if (cleanEngineerName) {
        const existingEngineer = engineers.data?.find(
          (engineer) =>
            engineer.full_name.trim().toLocaleLowerCase()
            === cleanEngineerName.toLocaleLowerCase(),
        );
        if (existingEngineer) {
          savedEngineerId = existingEngineer.id;
          if (
            engineerNumberDraft !== null
            && existingEngineer.phone !== (cleanEngineerNumber || null)
          ) {
            const { error: engineerError } = await supabase
              .from("engineers")
              .update({ phone: cleanEngineerNumber || null })
              .eq("id", existingEngineer.id);
            if (engineerError) throw engineerError;
          }
        } else {
          const { data, error: engineerError } = await supabase
            .from("engineers")
            .insert({
              full_name: cleanEngineerName,
              phone: cleanEngineerNumber || null,
            })
            .select("id")
            .single();
          if (engineerError) throw engineerError;
          savedEngineerId = data.id;
          await qc.invalidateQueries({ queryKey: ["job-form-engineers"] });
        }
      }

      let savedJobId = job?.id ?? persistedJobId;
      if (!savedJobId) {
        const { data, error: insertError } = await supabase
          .from("jobs")
          .insert({
            job_date: jobDate,
            call_type: callType,
            site_id: siteId,
            call_taken_by: callTakenBy,
            engineer_id: savedEngineerId,
            handover_status: handoverStatus,
            final_status: finalStatus,
            has_minor_issue: hasMinorIssue,
            remark: remark.trim() || null,
          })
          .select("id")
          .single();
        if (insertError) throw insertError;
        savedJobId = data.id;
        setPersistedJobId(savedJobId);
      } else {
        const { error: updateError } = await supabase
          .from("jobs")
          .update({
            job_date: jobDate,
            call_type: callType,
            site_id: siteId,
            call_taken_by: callTakenBy,
            engineer_id: savedEngineerId,
            handover_status: handoverStatus,
            final_status: finalStatus,
            has_minor_issue: hasMinorIssue,
            remark: remark.trim() || null,
          })
          .eq("id", savedJobId);
        if (updateError) throw updateError;
      }

      if (!savedJobId) throw new Error("The job could not be saved.");

      const sitePatch = {
        project_id: siteValues.projectId,
        project_type_id: siteValues.projectTypeId,
        branch_name: siteValues.branchName.trim() || null,
        state: siteValues.stateName || null,
        latitude: lat,
        longitude: lng,
      };
      const currentSite = siteDetails.data;
      if (
        currentSite.project_id !== sitePatch.project_id ||
        currentSite.project_type_id !== sitePatch.project_type_id ||
        currentSite.branch_name !== sitePatch.branch_name ||
        currentSite.state !== sitePatch.state ||
        currentSite.latitude !== sitePatch.latitude ||
        currentSite.longitude !== sitePatch.longitude
      ) {
        const { error: siteError } = await supabase
          .from("sites")
          .update(sitePatch)
          .eq("id", siteId);
        if (siteError) {
          throw new Error(
            "Job saved, but the site details could not be saved. Review the site details and try again.",
          );
        }
      }

      const shouldSaveDevice =
        !!existingDeviceId ||
        (selectedDeviceId === NEW_DEVICE &&
          (hasDeviceValues || !!simPhotoFile));
      let savedDeviceId = existingDeviceId;
      if (shouldSaveDevice) {
        const deviceResult = existingDeviceId
          ? await supabase
              .from("devices")
              .update(cleanDevice)
              .eq("id", existingDeviceId)
          : await supabase
              .from("devices")
              .insert({
                ...cleanDevice,
                site_id: siteId,
                device_status: "Active",
              })
              .select("id")
              .single();
        if (deviceResult.error) {
          throw new Error(
            "Job saved, but the device details could not be saved. Review the device and try again.",
          );
        }
        if (!existingDeviceId && deviceResult.data) {
          const createdDeviceId = deviceResult.data.id;
          savedDeviceId = createdDeviceId;
          setPersistedDeviceId(createdDeviceId);
          setDeviceDraft({
            siteId,
            deviceId: createdDeviceId,
            fields: deviceFields,
          });
        }
      }

      if (simPhotoFile) {
        if (!savedDeviceId) {
          throw new JobFormValidationError(
            "Select or create a SIM record before uploading its photo.",
          );
        }
        const extension = simPhotoExtension(simPhotoFile);
        if (!extension) {
          throw new JobFormValidationError(
            "Choose a JPG, PNG, WebP, or HEIC image.",
          );
        }
        const photoPath = `${siteId}/${savedDeviceId}.${extension}`;
        setUploadingSimPhoto(true);
        const { error: uploadError } = await supabase.storage
          .from("sim-photos")
          .upload(photoPath, simPhotoFile, {
            contentType: simPhotoFile.type || SIM_PHOTO_TYPES[extension],
            upsert: true,
          });
        if (uploadError) {
          throw new Error(
            `Job saved, but the SIM photo could not be uploaded: ${uploadError.message}`,
          );
        }
        const { error: photoPathError } = await supabase
          .from("devices")
          .update({ sim_photo_path: photoPath })
          .eq("id", savedDeviceId);
        if (photoPathError) {
          throw new Error(
            "Job saved and the photo uploaded, but it could not be linked to the SIM record. Please retry.",
          );
        }
        setUploadingSimPhoto(false);
        void qc.invalidateQueries({ queryKey: ["devices", "by-site", siteId] });
        void qc.invalidateQueries({ queryKey: ["devices-all"] });
      }

      const issuesToInsert = materialDrafts
        .filter((material) => material.item && material.problem)
        .map((material) => ({
          job_id: savedJobId,
          item: material.item,
          problem: material.problem,
          quantity: Number(material.quantity),
          status: material.status,
        }));
      if (issuesToInsert.length > 0) {
        const { error: materialError } = await supabase
          .from("material_issues")
          .insert(issuesToInsert);
        if (materialError) {
          throw new Error(
            "Job saved, but material issues could not be saved. Review the issue details and try again.",
          );
        }
      }

      return savedJobId;
    },
    onSuccess: (id) => {
      setUploadingSimPhoto(false);
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["site", siteId] });
      void qc.invalidateQueries({ queryKey: ["sites"] });
      void qc.invalidateQueries({ queryKey: ["devices", "by-site", siteId] });
      void qc.invalidateQueries({ queryKey: ["job", id] });
      void qc.invalidateQueries({ queryKey: ["job-materials", id] });
      if (!job) onSaved?.(id);
      onClose();
    },
    onError: (err) => {
      setUploadingSimPhoto(false);
      setError(friendlySaveError(err));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    setError("");
    setSimPhotoError("");

    if (!jobDate) return setError("Pick the job date.");
    if (!callType) return setError("Choose a call type.");
    if (!branchCode.trim()) return setError("Enter the Branch Code.");
    if (lookupCode.isError)
      return setError("Could not check this Branch Code. Please try again.");
    if (!siteId)
      return setError(
        "No site found for this Branch Code. Add the site first, under Sites.",
      );
    if (!siteReady)
      return setError(
        "Wait for the selected site's details to finish loading.",
      );
    if (devices.isLoading)
      return setError("Wait for this site's device records to finish loading.");
    if (devices.isError)
      return setError(
        "Could not load this site's device records. Please retry or use Devices.",
      );
    if (!siteValues?.projectId)
      return setError("Choose a project for this site.");
    if (!siteValues.projectTypeId)
      return setError("Choose a project type for this site.");
    if (!callTakenBy) return setError("Choose who took the call.");
    if (!finalStatus) return setError("Choose a final status.");
    if (simPhotoFile && !selectedDeviceId)
      return setSimPhotoError("Choose a device record before uploading a SIM photo.");
    if (simPhotoFile && simPhotoFile.size > SIM_PHOTO_MAX_BYTES)
      return setSimPhotoError("SIM photo must be 5 MB or smaller.");
    if (simPhotoFile && !simPhotoExtension(simPhotoFile))
      return setSimPhotoError("Choose a JPG, PNG, WebP, or HEIC image.");

    const incompleteMaterial = materialDrafts.find(
      (material) =>
        !!material.item !== !!material.problem ||
        (material.item &&
          (!Number.isInteger(Number(material.quantity)) ||
            Number(material.quantity) < 1 ||
            Number(material.quantity) > 1000)),
    );
    if (incompleteMaterial) {
      return setError(
        "Each material issue needs an item, a problem, and a quantity from 1 to 1000.",
      );
    }

    save.mutate();
  }

  function updateMaterial(index: number, patch: Partial<MaterialDraft>) {
    setMaterialDrafts((current) =>
      current.map((material, i) =>
        i === index ? { ...material, ...patch } : material,
      ),
    );
  }

  const projectTypeOptions = (projectTypes.data ?? []).filter(
    (type) =>
      type.project_id === siteValues?.projectId &&
      (type.is_active || type.id === siteValues?.projectTypeId),
  );
  const loading =
    callTypes.isLoading ||
    handoverStatuses.isLoading ||
    finalStatuses.isLoading ||
    materialItems.isLoading ||
    materialProblems.isLoading ||
    engineers.isLoading ||
    support.isLoading ||
    projects.isLoading ||
    projectTypes.isLoading ||
    states.isLoading;
  const lookupError =
    callTypes.isError ||
    handoverStatuses.isError ||
    finalStatuses.isError ||
    materialItems.isError ||
    materialProblems.isError ||
    engineers.isError ||
    support.isError ||
    projects.isError ||
    projectTypes.isError ||
    states.isError;
  const isRuleCheckOk =
    (finalStatus === "Completed" || finalStatus === "Live") &&
    handoverStatus !== "Pending" &&
    !materialDrafts.some(
      (material) => material.item && material.status === "Pending",
    );

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal job-entry-modal"
        role="dialog"
        aria-modal="true"
        aria-label={job ? "Edit job" : "New job"}
      >
        <h2>{job ? `Edit Job #${job.job_no}` : "Record work details"}</h2>
        {loading ? (
          <div className="form-loading" aria-label="Loading form options">
            <span className="skeleton-bar" />
            <span className="skeleton-bar" />
            <span className="skeleton-bar" />
          </div>
        ) : lookupError ? (
          <div className="banner error" role="alert">
            Could not load the form options. Please close and reopen this form.
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="job-entry-form">
            <fieldset className="form-section">
              <legend>Job details</legend>
              <div className="grid-form">
                <label>
                  <span className="field-caption">
                    Date <span className="field-required">*</span>
                  </span>
                  <input
                    aria-required="true"
                    type="date"
                    value={jobDate}
                    onChange={(e) => setJobDate(e.target.value)}
                  />
                </label>
                <label>
                  <span className="field-caption">
                    Call type <span className="field-required">*</span>
                  </span>
                  <select
                    aria-required="true"
                    value={callType}
                    onChange={(e) => setCallType(e.target.value)}
                  >
                    <option value="">Select call type</option>
                    {callTypes.data?.map((call) => (
                      <option key={call.name} value={call.name}>
                        {call.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="field-caption">
                    Branch code <span className="field-required">*</span>
                  </span>
                  <input
                    aria-required="true"
                    value={branchCode}
                    onChange={(e) => setBranchCode(e.target.value)}
                    placeholder="e.g. 740_Bangarapete"
                  />
                  {branchCode.trim() && (
                    <span className={siteId ? "hint ok" : "hint bad"}>
                      {lookupCode.isFetching
                        ? "Looking up site..."
                        : lookupCode.isError
                          ? "Could not check this Branch Code. Please try again."
                          : siteId
                            ? `Found: ${lookupCode.data?.branch_name ?? "site"}`
                            : "Not found. Add this site under Sites first."}
                    </span>
                  )}
                </label>
                <label>
                  <span className="field-caption">
                    Call taken by <span className="field-required">*</span>
                  </span>
                  <select
                    aria-required="true"
                    value={callTakenBy}
                    onChange={(e) => setCallTakenBy(e.target.value)}
                  >
                    <option value="">Select person</option>
                    {support.data?.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="field-caption">
                    Engineer <span className="field-optional">Optional</span>
                  </span>
                  <input
                    list="job-form-engineer-names"
                    value={engineerName}
                    onChange={(e) => setEngineerNameDraft(e.target.value)}
                    placeholder="Type engineer name"
                  />
                  <datalist id="job-form-engineer-names">
                    {engineers.data?.filter((engineer) => engineer.is_active).map((engineer) => (
                      <option key={engineer.id} value={engineer.full_name} />
                    ))}
                  </datalist>
                </label>
                <label>
                  <span className="field-caption">Engineer number</span>
                  <input
                    value={engineerNumber}
                    onChange={(e) => setEngineerNumberDraft(e.target.value)}
                    placeholder="Type engineer number"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend>
                Site details{" "}
                <span className="field-optional">shared site record</span>
              </legend>
              {!siteId ? (
                <p className="muted small">
                  Enter an existing branch code to load and update its site
                  details.
                </p>
              ) : siteDetails.isError ? (
                <div className="banner error" role="alert">
                  Could not load this site's details. Please retry or use Sites.
                </div>
              ) : !siteReady ? (
                <div className="form-loading">
                  <span className="skeleton-bar" />
                  <span className="skeleton-bar" />
                </div>
              ) : (
                <div className="grid-form">
                  <label>
                    <span className="field-caption">
                      Project <span className="field-required">*</span>
                    </span>
                    <select
                      value={siteValues?.projectId ?? ""}
                      onChange={(e) =>
                        updateSiteDraft({
                          projectId: e.target.value,
                          projectTypeId: "",
                        })
                      }
                    >
                      <option value="">Select project</option>
                      {(projects.data ?? [])
                        .filter(
                          (project) =>
                            project.is_active ||
                            project.id === siteValues?.projectId,
                        )
                        .map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <span className="field-caption">
                      Project type <span className="field-required">*</span>
                    </span>
                    <select
                      value={siteValues?.projectTypeId ?? ""}
                      onChange={(e) =>
                        updateSiteDraft({ projectTypeId: e.target.value })
                      }
                      disabled={!siteValues?.projectId}
                    >
                      <option value="">Select type</option>
                      {projectTypeOptions.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="field-caption">
                      Branch name{" "}
                      <span className="field-optional">Optional</span>
                    </span>
                    <input
                      value={siteValues?.branchName ?? ""}
                      onChange={(e) =>
                        updateSiteDraft({ branchName: e.target.value })
                      }
                      maxLength={120}
                    />
                  </label>
                  <label>
                    <span className="field-caption">
                      State <span className="field-optional">Optional</span>
                    </span>
                    <select
                      value={siteValues?.stateName ?? ""}
                      onChange={(e) =>
                        updateSiteDraft({ stateName: e.target.value })
                      }
                    >
                      <option value="">Select state</option>
                      {(states.data ?? []).map((state) => (
                        <option key={state.name} value={state.name}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="field-caption">
                      Latitude <span className="field-optional">Optional</span>
                    </span>
                    <input
                      inputMode="decimal"
                      value={siteValues?.latitude ?? ""}
                      onChange={(e) =>
                        updateSiteDraft({ latitude: e.target.value })
                      }
                      placeholder="22.483586"
                    />
                  </label>
                  <label>
                    <span className="field-caption">
                      Longitude <span className="field-optional">Optional</span>
                    </span>
                    <input
                      inputMode="decimal"
                      value={siteValues?.longitude ?? ""}
                      onChange={(e) =>
                        updateSiteDraft({ longitude: e.target.value })
                      }
                      placeholder="72.801502"
                    />
                  </label>
                </div>
              )}
            </fieldset>

            <fieldset className="form-section">
              <legend>
                Active device{" "}
                <span className="field-optional">shared device record</span>
              </legend>
              {!siteId ? (
                <p className="muted small">
                  Select a site to load its devices.
                </p>
              ) : devices.isError ? (
                <div className="banner error" role="alert">
                  Could not load this site's devices. Please retry or use
                  Devices.
                </div>
              ) : devices.isLoading ? (
                <div className="form-loading">
                  <span className="skeleton-bar" />
                  <span className="skeleton-bar" />
                </div>
              ) : (
                <>
                  <label>
                    Device record
                    <select
                      value={selectedDeviceId}
                      onChange={(e) => {
                        const id = e.target.value;
                        chooseDevice(id);
                      }}
                    >
                      <option value="">Do not update a device</option>
                      {activeDevices.map((device, index) => (
                        <option key={device.id} value={device.id}>
                          Active device {index + 1}
                          {device.sim_name ? ` — ${device.sim_name}` : ""}
                        </option>
                      ))}
                      <option value={NEW_DEVICE}>
                        Add a new active device
                      </option>
                    </select>
                  </label>
                  <div className="grid-form">
                    {(
                      [
                        ["sim_name", "SIM Name"],
                        ["sim_number", "SIM Card No."],
                        ["link_ip", "Link IP"],
                        ["link_mac_id", "Link Device MAC ID"],
                        ["vault_tam", "Vault TAM"],
                        ["cash_counter_tam", "Cash Counter TAM"],
                        ["main_door_tam", "Main Door TAM"],
                        ["ngl_main_door_tam", "NGL Main Door"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        <span className="field-caption">
                          {label}{" "}
                          <span className="field-optional">Optional</span>
                        </span>
                        <input
                          value={deviceFields[key]}
                          onChange={(e) =>
                            updateDeviceField(key, e.target.value)
                          }
                          maxLength={120}
                          disabled={!selectedDeviceId}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="sim-photo-field full">
                    <span className="field-caption">
                      SIM card photo{" "}
                      <span className="field-optional">Optional</span>
                    </span>
                    <input
                      ref={simPhotoInputRef}
                      className="sim-photo-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic"
                      disabled={!selectedDeviceId || save.isPending}
                      onChange={(event) => {
                        chooseSimPhoto(event.currentTarget.files?.[0] ?? null);
                        event.currentTarget.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className="secondary sim-photo-choose"
                      disabled={!selectedDeviceId || save.isPending}
                      onClick={() => simPhotoInputRef.current?.click()}
                    >
                      {simPhotoFile
                        ? "Choose a different photo"
                        : selectedPhotoPath
                          ? "Replace photo"
                          : "Choose photo"}
                    </button>
                    <span className="hint sim-photo-help">
                      {simPhotoFile?.name ??
                        "JPG, PNG, WebP, or HEIC · Maximum 5 MB. Saved to the selected SIM card."}
                    </span>
                    {simPhotoUrl && (
                      <span className="sim-photo-preview-wrap">
                        <img
                          className="sim-photo-preview"
                          src={simPhotoUrl}
                          alt="SIM card photo preview"
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                            setSimPhotoError("SIM photo preview could not be displayed.");
                          }}
                        />
                      </span>
                    )}
                    {selectedPhoto.isError && !simPhotoFile && (
                      <span className="hint bad">
                        Could not load the saved SIM photo.
                      </span>
                    )}
                    {simPhotoError && (
                      <span className="hint bad" role="alert">
                        {simPhotoError}
                      </span>
                    )}
                    {uploadingSimPhoto && (
                      <span className="hint">Uploading SIM photo...</span>
                    )}
                  </div>
                </>
              )}
            </fieldset>

            <fieldset className="form-section">
              <legend>Status and materials</legend>
              <div className="grid-form">
                <label>
                  <span className="field-caption">
                    Handover status <span className="field-required">*</span>
                  </span>
                  <select
                    value={handoverStatus}
                    onChange={(e) => setHandoverStatus(e.target.value)}
                  >
                    {handoverStatuses.data?.map((status) => (
                      <option key={status.name} value={status.name}>
                        {status.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="field-caption">
                    Final status <span className="field-required">*</span>
                  </span>
                  <select
                    value={finalStatus}
                    onChange={(e) => setFinalStatus(e.target.value)}
                  >
                    {finalStatuses.data?.map((status) => (
                      <option key={status.name} value={status.name}>
                        {status.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="field-caption">
                    Minor issue <span className="field-required">*</span>
                  </span>
                  <select
                    value={hasMinorIssue ? "Yes" : "No"}
                    onChange={(e) => setHasMinorIssue(e.target.value === "Yes")}
                  >
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </label>
                <div className="rule-preview">
                  <span className="field-caption">Rule Check</span>
                  <span>{isRuleCheckOk ? "OK" : "-"}</span>
                </div>
              </div>

              <div className="material-entry-list">
                <div className="head-row">
                  <div>
                    <strong>Material issues</strong>
                    <p className="muted small">
                      Optional; the jobs table summarizes pending issues.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setMaterialDrafts((current) => [
                        ...current,
                        {
                          item: "",
                          problem: "",
                          quantity: "1",
                          status: "Pending",
                        },
                      ])
                    }
                  >
                    Add issue
                  </button>
                </div>
                {materialDrafts.map((material, index) => (
                  <div className="material-entry" key={index}>
                    <label>
                      Item
                      <select
                        value={material.item}
                        onChange={(e) =>
                          updateMaterial(index, { item: e.target.value })
                        }
                      >
                        <option value="">Select item</option>
                        {materialItems.data?.map((item) => (
                          <option key={item.name} value={item.name}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Problem
                      <select
                        value={material.problem}
                        onChange={(e) =>
                          updateMaterial(index, { problem: e.target.value })
                        }
                      >
                        <option value="">Select problem</option>
                        {materialProblems.data?.map((problem) => (
                          <option key={problem.name} value={problem.name}>
                            {problem.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Quantity
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={material.quantity}
                        onChange={(e) =>
                          updateMaterial(index, { quantity: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Status
                      <select
                        value={material.status}
                        onChange={(e) =>
                          updateMaterial(index, {
                            status: e.target.value as MaterialDraft["status"],
                          })
                        }
                      >
                        <option value="Pending">Pending</option>
                        <option value="Resolved">Resolved</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="link"
                      aria-label={`Remove material issue ${index + 1}`}
                      onClick={() =>
                        setMaterialDrafts((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </fieldset>

            <label className="full">
              <span className="field-caption">
                Site Remark <span className="field-optional">Optional</span>
              </span>
              <textarea
                rows={3}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </label>

            {error && (
              <div className="banner error full form-error" role="alert">
                {error}
              </div>
            )}

            <div className="actions full">
              <button
                type="button"
                className="secondary"
                onClick={onClose}
                disabled={save.isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  save.isPending ||
                  loading ||
                  lookupCode.isFetching ||
                  (!!siteId && (siteDetails.isLoading || devices.isLoading))
                }
              >
                {save.isPending
                  ? uploadingSimPhoto
                    ? "Uploading SIM photo..."
                    : "Saving..."
                  : job || persistedJobId
                    ? "Save changes"
                    : "Save job details"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
