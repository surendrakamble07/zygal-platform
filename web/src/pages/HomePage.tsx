import { useEffect, useState } from "react";
import { useAuth, type Role } from "../auth/auth-context";
import { supabase } from "../lib/supabase";

interface SessionRow {
  id: string;
  started_at: string;
  last_active_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

const ROLE_LABEL: Record<Role, string> = {
  support: "Support",
  team_lead: "Team Lead / Assistant Manager",
  admin: "Admin",
};

const fmt = (iso: string) => new Date(iso).toLocaleString();

export default function HomePage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<SessionRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("user_sessions")
        .select("id, started_at, last_active_at, ended_at, end_reason")
        .order("started_at", { ascending: false })
        .limit(5);
      if (!cancelled) setRows((data ?? []) as SessionRow[]);
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!profile) return null;

  return (
    <>
      <section className="card">
        <h2>Welcome, {profile.full_name}</h2>
        <p className="muted">
          {ROLE_LABEL[profile.role]} · {profile.email}
        </p>
      </section>

      <section className="card">
        <h3>Your recent sessions</h3>
        <p className="muted small">
          Login, activity and logout times recorded by the platform.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Logged in</th>
                <th>Last active</th>
                <th>Ended</th>
                <th>How</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No sessions yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmt(r.started_at)}</td>
                  <td>{fmt(r.last_active_at)}</td>
                  <td>{r.ended_at ? fmt(r.ended_at) : "Still active"}</td>
                  <td>{r.end_reason ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
