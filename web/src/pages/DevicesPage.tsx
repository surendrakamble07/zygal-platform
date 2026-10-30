import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 25;

interface DeviceRow {
  id: string;
  site_id: string;
  sim_name: string | null;
  sim_number: string | null;
  sim_photo_url: string | null;
  link_ip: string | null;
  link_mac_id: string | null;
  device_status: string;
  branch_code: string;
  project_name: string;
}

function NoPhoto() {
  return (
    <svg className="sim-photo-placeholder-icon" viewBox="0 0 48 48" role="img" aria-label="No photo">
      <rect x="5" y="8" width="38" height="32" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="17" cy="19" r="3.5" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="m8 35 11-11 7 7 5-5 9 9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function SimPhoto({ src, name }: { src: string | null; name: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className="sim-photo-placeholder"><NoPhoto /></div>;
  }
  return (
    <img
      className="sim-card-photo"
      src={src}
      alt={name ? `${name} SIM card` : "SIM card"}
      onError={() => setFailed(true)}
    />
  );
}

export default function DevicesPage() {
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const devices = useQuery({
    queryKey: ["devices-all", { page, search, status }],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from("devices")
        .select(
          "id, site_id, sim_name, sim_number, sim_photo_path, link_ip, link_mac_id, device_status, site:sites!inner ( branch_code, project:projects!sites_project_id_fkey ( name ) )",
          { count: "exact" },
        )
        .is("deleted_at", null);

      if (status) q = q.eq("device_status", status);
      const clean = search.replace(/[,()*%\\"]/g, " ").trim();
      if (clean) q = q.ilike("site.branch_code", `*${clean}*`);

      const from = page * PAGE_SIZE;
      const { data, count, error } = await q
        .order("device_status")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;

      const rows = await Promise.all((data ?? []).map(async (r): Promise<DeviceRow> => {
        const site = Array.isArray(r.site) ? r.site[0] : r.site;
        const project = site?.project
          ? Array.isArray(site.project) ? site.project[0] : site.project
          : null;
        let photoUrl: string | null = null;
        if (r.sim_photo_path) {
          const { data: signedUrl, error: photoError } = await supabase.storage
            .from("sim-photos")
            .createSignedUrl(r.sim_photo_path, 3600);
          if (photoError) throw photoError;
          photoUrl = signedUrl.signedUrl;
        }
        return {
          id: r.id,
          site_id: r.site_id,
          sim_name: r.sim_name,
          sim_number: r.sim_number,
          sim_photo_url: photoUrl,
          link_ip: r.link_ip,
          link_mac_id: r.link_mac_id,
          device_status: r.device_status,
          branch_code: site?.branch_code ?? "-",
          project_name: project?.name ?? "-",
        };
      }));
      return { rows, total: count ?? 0 };
    },
  });

  const rows = devices.data?.rows ?? [];
  const total = devices.data?.total ?? 0;
  return (
    <section className="card">
      <div className="head-row">
        <h2>SIM Cards</h2>
      </div>
      <p className="muted small">
        To add a SIM card, open its site under Sites and use "Add SIM card" there.
      </p>

      <div className="filters">
        <input
          type="search"
          placeholder="Search by branch code"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Any status</option>
          <option value="Active">Active</option>
          <option value="Replaced">Replaced</option>
        </select>
      </div>

      {devices.isError && (
        <div className="banner error" role="alert">
          Could not load SIM cards. Please refresh and try again.
        </div>
      )}

      {devices.isLoading ? (
        <div className="sim-card-grid" aria-label="Loading SIM cards">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="sim-card sim-card-loading" key={index}>
              <span className="skeleton-bar" />
              <span className="skeleton-bar" />
              <span className="skeleton-bar" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <NoPhoto />
          <span>No SIM cards match these filters.</span>
        </div>
      ) : (
        <div className="sim-card-grid">
          {rows.map((sim) => (
            <article className="sim-card" key={sim.id}>
              <SimPhoto src={sim.sim_photo_url} name={sim.sim_name} />
              <div className="sim-card-content">
                <div className="sim-card-heading">
                  <h3>{sim.sim_name || "Unnamed SIM"}</h3>
                  <StatusBadge status={sim.device_status} />
                </div>
                <p className="sim-card-number">{sim.sim_number || "No SIM number"}</p>
                <div className="sim-card-site">
                  <Link to={`/sites/${sim.site_id}`}>{sim.branch_code}</Link>
                  <span>{sim.project_name}</span>
                </div>
                <dl className="sim-card-details">
                  <div><dt>Link IP</dt><dd>{sim.link_ip || "-"}</dd></div>
                  <div><dt>MAC ID</dt><dd>{sim.link_mac_id || "-"}</dd></div>
                </dl>
              </div>
            </article>
          ))}
        </div>
      )}

      <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} disabled={devices.isFetching} itemLabel="SIM cards" />
    </section>
  );
}
