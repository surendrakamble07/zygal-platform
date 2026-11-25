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
  useVendorTypes,
} from "../lib/job-queries";
import { useDevicesForSite } from "../lib/device-queries";
import { useProjectTypes } from "../lib/queries";
import { friendlyJobError } from "../lib/job-errors";
import { coordinatesFromMapLink } from "../lib/site-location";
import {
  EMPTY_JOB_TESTING_VALUES,
  jobTestingValuesForSave,
  type JobTestingValues,
} from "../lib/job-testing";
import type { Device } from "../lib/device-types";
import type { Job } from "../lib/job-types";
import JobTestingFields from "../components/JobTestingFields";

interface Props {
  job: Job | null;
  onClose: () => void;
  onSaved?: (jobId: string) => void;
}

interface SiteDetails {
  id: string;
  project_id: string;
  project_type_id: string | null;
  latitude: number | null;
  longitude: number | null;
  status: "Active" | "Inactive";
}

interface SiteDraft {
  siteId: string;
  projectId: string;
  projectTypeId: string;
  latitude: string;
  longitude: string;
  status: "Active" | "Inactive";
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
  vendor: string | null;
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
}

class JobFormValidationError extends Error {}

const NEW_DEVICE = "__new_device__";
const PENDING_FINAL_STATUSES = new Set(["Completed", "WIP", "Minor Issue"]);
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
  const vendorTypes = useVendorTypes();
  const projectTypes = useProjectTypes();
  const engineers = useQuery({
    queryKey: ["job-form-engineers"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("engineers")
        .select("id, full_name, phone, vendor, is_active")
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
  const [engineerVendorSelection, setEngineerVendorSelection] = useState<string | null>(null);
  const [engineerNameError, setEngineerNameError] = useState("");
  const [engineerNumberError, setEngineerNumberError] = useState("");
  const [remarkError, setRemarkError] = useState("");
  const initialHandoverStatus = job?.handover_status ?? "Pending";
  const [handoverStatus, setHandoverStatus] = useState(initialHandoverStatus);
  const [finalStatus, setFinalStatus] = useState(
    initialHandoverStatus === "Completed"
      ? "Live"
      : job?.final_status && PENDING_FINAL_STATUSES.has(job.final_status)
        ? job.final_status
        : "WIP",
  );
  const [hasMaterialIssue, setHasMaterialIssue] = useState(false);
  const [remark, setRemark] = useState(job?.remark ?? "");
  const [siteDraft, setSiteDraft] = useState<SiteDraft | null>(null);
  const [siteMapLink, setSiteMapLink] = useState({
    siteId: "",
    value: "",
    message: "",
  });
  const [deviceDraft, setDeviceDraft] = useState<DeviceDraft | null>(null);
  const [persistedDeviceId, setPersistedDeviceId] = useState<string | null>(
    null,
  );
  const [simPhotoFile, setSimPhotoFile] = useState<File | null>(null);
  const [simPhotoError, setSimPhotoError] = useState("");
  const [uploadingSimPhoto, setUploadingSimPhoto] = useState(false);
  const simPhotoInputRef = useRef<HTMLInputElement>(null);
  const [materialDrafts, setMaterialDrafts] = useState<MaterialDraft[]>([]);
  const [testingValues, setTestingValues] = useState<JobTestingValues>(() => ({
    ...EMPTY_JOB_TESTING_VALUES,
  }));
  const [error, setError] = useState("");
  const [persistedJobId, setPersistedJobId] = useState<string | null>(null);
  const showMaterialIssueBlock =
    handoverStatus === "Pending" && PENDING_FINAL_STATUSES.has(finalStatus);

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
          "id, project_id, project_type_id, latitude, longitude, status",
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
  const engineerVendorDraft =
    engineerVendorSelection ??
    matchingEngineer?.vendor ??
    (engineerNameDraft === null ? assignedEngineer?.vendor : null) ??
    null;
  const engineerVendor =
    engineerVendorDraft ??
    "";
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
            projectTypeId: loadedSite.project_type_id ?? "",
            latitude:
              loadedSite.latitude == null ? "" : String(loadedSite.latitude),
            longitude:
              loadedSite.longitude == null ? "" : String(loadedSite.longitude),
            status: loadedSite.status ?? "Active",
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
          : loadedSite.project_type_id ?? "",
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
      status:
        current && current.siteId === siteId
          ? current.status
          : loadedSite.status ?? "Active",
      ...patch,
    }));
  }

  function updateSiteMapLink(value: string) {
    const coordinates = coordinatesFromMapLink(value.trim());
    setSiteMapLink({
      siteId,
      value,
      message: value.trim() && !coordinates
        ? "Coordinates not found. Enter latitude and longitude manually."
        : "",
    });
    if (coordinates) {
      updateSiteDraft({
        latitude: String(coordinates.latitude),
        longitude: String(coordinates.longitude),
      });
    }
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
          material.item && material.problem,
      ).length;
      if (finalStatus === "Live" && pendingMaterialCount > 0) {
        throw new JobFormValidationError(
          "A job cannot be Live while a material issue is Pending.",
        );
      }
      if (
        showMaterialIssueBlock
        && hasMaterialIssue
        && !materialDrafts.some((material) => material.item && material.problem)
      ) {
        throw new JobFormValidationError(
          "Enter an item, problem, and quantity for at least one material issue.",
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
      const cleanEngineerVendor = engineerVendor.trim();
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
          const engineerUpdates: Record<string, string | null> = {};
          if (
            engineerNumberDraft !== null
            && existingEngineer.phone !== (cleanEngineerNumber || null)
          ) {
            engineerUpdates.phone = cleanEngineerNumber || null;
          }
          if (
            engineerVendorSelection !== null
            && (existingEngineer.vendor ?? null) !== (cleanEngineerVendor || null)
          ) {
            engineerUpdates.vendor = cleanEngineerVendor || null;
          }
          if (Object.keys(engineerUpdates).length > 0) {
            const { error: engineerError } = await supabase
              .from("engineers")
              .update(engineerUpdates)
              .eq("id", existingEngineer.id);
            if (engineerError) throw engineerError;
          }
        } else {
          const { data, error: engineerError } = await supabase
            .from("engineers")
            .insert({
              full_name: cleanEngineerName,
              phone: cleanEngineerNumber || null,
              vendor: cleanEngineerVendor || null,
            })
            .select("id")
            .single();
          if (engineerError) throw engineerError;
          savedEngineerId = data.id;
          await qc.invalidateQueries({ queryKey: ["job-form-engineers"] });
        }
      }

      const currentSite = siteDetails.data;
      const sitePatch = {
        project_type_id: siteValues.projectTypeId || null,
        latitude: lat,
        longitude: lng,
        status: siteValues.status,
      };
      if (
        currentSite.project_type_id !== sitePatch.project_type_id ||
        currentSite.latitude !== sitePatch.latitude ||
        currentSite.longitude !== sitePatch.longitude ||
        currentSite.status !== sitePatch.status
      ) {
        const { error: siteError } = await supabase
          .from("sites")
          .update(sitePatch)
          .eq("id", siteId);
        if (siteError) {
          throw new JobFormValidationError(
            `Could not save site details: ${siteError.message}`,
          );
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
            remark: remark.trim(),
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
            remark: remark.trim(),
          })
          .eq("id", savedJobId);
        if (updateError) throw updateError;
      }

      if (!savedJobId) throw new Error("The job could not be saved.");

      if (!job) {
        const { error: testingError } = await supabase
          .from("job_testing_details")
          .upsert(
            {
              job_id: savedJobId,
              ...jobTestingValuesForSave(testingValues),
              updated_by: profile?.id ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "job_id" },
          );
        if (testingError) {
          throw new Error(
            "Job saved, but testing details could not be saved. Please retry.",
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
          status: "Pending",
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

    const hasEngineerName = !!engineerName.trim();
    const hasEngineerNumber = !!engineerNumber.trim();
    const hasRemark = !!remark.trim();
    setEngineerNameError(hasEngineerName ? "" : "Engineer name is required.");
    setEngineerNumberError(hasEngineerNumber ? "" : "Engineer number is required.");
    setRemarkError(hasRemark ? "" : "Site Remark is required.");
    if (!hasEngineerName || !hasEngineerNumber || !hasRemark) return;

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
    if (!callTakenBy) return setError("Choose who took the call.");
    if (!finalStatus) return setError("Choose a final status.");
    if (
      showMaterialIssueBlock
      && hasMaterialIssue
      && !materialDrafts.some((material) => material.item && material.problem)
    ) {
      return setError(
        "Enter an item, problem, and quantity for at least one material issue.",
      );
    }
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
    projectTypes.isLoading;
  const lookupError =
    callTypes.isError ||
    handoverStatuses.isError ||
    finalStatuses.isError ||
    materialItems.isError ||
    materialProblems.isError ||
    engineers.isError ||
    support.isError ||
    projectTypes.isError;
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
                    Engineer Name <span className="field-required">*</span>
                  </span>
                  <input
                    list="job-form-engineer-names"
                    value={engineerName}
                    onChange={(e) => {
                      setEngineerNameDraft(e.target.value);
                      setEngineerVendorSelection(null);
                      if (e.target.value.trim()) setEngineerNameError("");
                    }}
                    placeholder="Type engineer name"
                    aria-required="true"
                    aria-invalid={!!engineerNameError}
                  />
                  {engineerNameError && <span className="hint bad" role="alert">{engineerNameError}</span>}
                  <datalist id="job-form-engineer-names">
                    {engineers.data?.filter((engineer) => engineer.is_active).map((engineer) => (
                      <option key={engineer.id} value={engineer.full_name} />
                    ))}
                  </datalist>
                </label>
                <label>
                  <span className="field-caption">
                    Engineer number <span className="field-required">*</span>
                  </span>
                  <input
                    type="tel"
                    value={engineerNumber}
                    onChange={(e) => {
                      setEngineerNumberDraft(e.target.value);
                      if (e.target.value.trim()) setEngineerNumberError("");
                    }}
                    placeholder="Type engineer number"
                    aria-required="true"
                    aria-invalid={!!engineerNumberError}
                  />
                  {engineerNumberError && <span className="hint bad" role="alert">{engineerNumberError}</span>}
                </label>
                <label>
                  <span className="field-caption">Vendor</span>
                  <select
                    value={engineerVendor}
                    onChange={(e) => setEngineerVendorSelection(e.target.value)}
                  >
                    <option value="">In-house</option>
                    {vendorTypes.data?.map((vendor) => (
                      <option key={vendor.name} value={vendor.name}>{vendor.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>

            {siteId && siteDetails.isError && (
              <div className="banner error" role="alert">
                Could not load this site's details. Please retry or use Sites.
              </div>
            )}
            {siteId && !siteReady && !siteDetails.isError && (
              <div className="form-loading">
                <span className="skeleton-bar" />
                <span className="skeleton-bar" />
              </div>
            )}
            {siteReady && (
              <details className="form-section collapsible-form-section">
                <summary>
                  Site details{" "}
                  <span className="field-optional">Optional — view or update this site</span>
                </summary>
                <div className="grid-form">
                  <label>
                    <span className="field-caption">
                      Project type <span className="field-optional">Optional</span>
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
                      Status <span className="field-required">*</span>
                    </span>
                    <select
                      value={siteValues?.status ?? "Active"}
                      onChange={(e) =>
                        updateSiteDraft({
                          status: e.target.value === "Inactive" ? "Inactive" : "Active",
                        })
                      }
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </label>
                  <label className="full">
                    <span className="field-caption">
                      Google Maps link{" "}
                      <span className="field-optional">Optional</span>
                    </span>
                    <input
                      type="url"
                      value={siteMapLink.siteId === siteId ? siteMapLink.value : ""}
                      onChange={(e) => updateSiteMapLink(e.target.value)}
                      onPaste={(e) => {
                        const pasted = e.clipboardData.getData("text").trim();
                        if (!pasted) return;
                        e.preventDefault();
                        updateSiteMapLink(pasted);
                      }}
                      placeholder="Paste a Google Maps link to fill coordinates"
                    />
                    {siteMapLink.siteId === siteId && siteMapLink.message && (
                      <span className="hint" role="status">{siteMapLink.message}</span>
                    )}
                  </label>
                  <label>
                    <span className="field-caption">
                      Latitude <span className="field-optional">Optional</span>
                    </span>
                    <input
                      type="number"
                      step="any"
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
                      type="number"
                      step="any"
                      value={siteValues?.longitude ?? ""}
                      onChange={(e) =>
                        updateSiteDraft({ longitude: e.target.value })
                      }
                      placeholder="72.801502"
                    />
                  </label>
                </div>
              </details>
            )}

            {!job && (
              <details className="form-section collapsible-form-section">
                <summary>
                  Testing <span className="field-optional">Optional</span>
                </summary>
                <JobTestingFields
                  values={testingValues}
                  onChange={(patch) =>
                    setTestingValues((current) => ({ ...current, ...patch }))
                  }
                />
              </details>
            )}

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
                    onChange={(e) => {
                      const nextStatus = e.target.value;
                      setHandoverStatus(nextStatus);
                      if (nextStatus === "Completed") {
                        setFinalStatus("Live");
                        setHasMaterialIssue(false);
                        setMaterialDrafts([]);
                      } else if (finalStatus === "Live") {
                        setFinalStatus("WIP");
                      }
                    }}
                  >
                    {handoverStatuses.data?.map((status) => (
                      <option key={status.name} value={status.name}>
                        {status.name}
                      </option>
                    ))}
                  </select>
                </label>
                {handoverStatus === "Completed" ? (
                  <div>
                    <span className="field-caption">Final status</span>
                    <div>Live</div>
                  </div>
                ) : (
                  <label>
                    <span className="field-caption">
                      Final status <span className="field-required">*</span>
                    </span>
                    <select
                      value={finalStatus}
                      onChange={(e) => {
                        setFinalStatus(e.target.value);
                        if (!PENDING_FINAL_STATUSES.has(e.target.value)) {
                          setHasMaterialIssue(false);
                          setMaterialDrafts([]);
                        }
                      }}
                    >
                      {finalStatuses.data
                        ?.filter((status) => PENDING_FINAL_STATUSES.has(status.name))
                        .map((status) => (
                          <option key={status.name} value={status.name}>
                            {status.name}
                          </option>
                        ))}
                  </select>
                </label>
                )}
              </div>

              {showMaterialIssueBlock && (
                <label>
                  Any material issue?
                  <select
                    value={hasMaterialIssue ? "Yes" : "No"}
                    onChange={(e) => {
                      const hasIssue = e.target.value === "Yes";
                      setHasMaterialIssue(hasIssue);
                      setMaterialDrafts(
                        hasIssue ? [{ item: "", problem: "", quantity: "1" }] : [],
                      );
                    }}
                  >
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </label>
              )}

              {showMaterialIssueBlock && hasMaterialIssue && (
              <div className="material-entry-list">
                <div className="head-row">
                  <div>
                    <strong>Material issues</strong>
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
              )}
            </fieldset>

            <label className="full">
              <span className="field-caption">
                Site Remark <span className="field-required">*</span>
              </span>
              <textarea
                rows={3}
                value={remark}
                onChange={(e) => {
                  setRemark(e.target.value);
                  if (e.target.value.trim()) setRemarkError("");
                }}
                aria-required="true"
                aria-invalid={!!remarkError}
              />
              {remarkError && <span className="hint bad" role="alert">{remarkError}</span>}
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
