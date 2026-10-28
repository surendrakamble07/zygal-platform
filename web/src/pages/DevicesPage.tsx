import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Icon from "../components/Icon";
import StatusBadge from "../components/StatusBadge";
import { TableEmptyState, TableSkeleton } from "../components/TableStates";

const PAGE_SIZE = 25;

interface DeviceRow {
  id: string;
  site_id: string;
  sim_name: string | null;
  link_ip: string | null;
  link_mac_id: string | null;
  device_status: string;
  branch_code: string;
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
          "id, site_id, sim_name, link_ip, link_mac_id, device_status, site:sites!inner ( branch_code )",
          {
            count: "exact",
          },
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

      const rows: DeviceRow[] = (data ?? []).map((r) => {
        const site = Array.isArray(r.site) ? r.site[0] : r.site;
        return {
          id: r.id,
          site_id: r.site_id,
          sim_name: r.sim_name,
          link_ip: r.link_ip,
          link_mac_id: r.link_mac_id,
          device_status: r.device_status,
          branch_code: site?.branch_code ?? "-",
        };
      });
      return { rows, total: count ?? 0 };
    },
  });

  const rows = devices.data?.rows ?? [];
  const total = devices.data?.total ?? 0;
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min((page + 1) * PAGE_SIZE, total);
  const hasNext = (page + 1) * PAGE_SIZE < total;

  return (
    <section className="card">
      <div className="head-row">
        <h2>Devices</h2>
      </div>
      <p className="muted small">
        To add a device, open its site under Sites and use "Add device" there.
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
        <div className="banner error">
          Could not load devices. Please refresh and try again.
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Branch</th>
              <th>SIM</th>
              <th>Link IP</th>
              <th>MAC ID</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {devices.isLoading && <TableSkeleton columns={5} />}
            {!devices.isLoading && rows.length === 0 && (
              <TableEmptyState
                columns={5}
                message="No devices match these filters."
              />
            )}
            {rows.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link
                    className="icon-action table-link"
                    aria-label={`View site ${d.branch_code}`}
                    to={`/sites/${d.site_id}`}
                  >
                    <Icon name="view" size={16} />
                    {d.branch_code}
                  </Link>
                </td>
                <td>{d.sim_name ?? "-"}</td>
                <td>{d.link_ip ?? "-"}</td>
                <td>{d.link_mac_id ?? "-"}</td>
                <td>
                  <StatusBadge status={d.device_status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="head-row">
        <span className="muted small">
          {total === 0
            ? "0 devices"
            : `Showing ${first}-${last} of ${total} devices`}
        </span>
        <div className="actions">
          <button
            className="secondary"
            disabled={page === 0 || devices.isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <button
            className="secondary"
            disabled={!hasNext || devices.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
