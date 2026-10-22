import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

export default function App() {
  const [msg, setMsg] = useState("Checking connection...");

  useEffect(() => {
    supabase
      .from("projects")
      .select("name")
      .then(({ data, error }) => {
        if (error?.code === "42501") {
          setMsg(
            "Connected to Supabase. Anonymous access is correctly blocked.",
          );
        } else if (error) {
          setMsg("Problem: " + error.message);
        } else {
          setMsg(
            `Warning: anonymous visitors can read ${data?.length ?? 0} rows. Tell Claude.`,
          );
        }
      });
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>ZYGAL</h1>
      <p>{msg}</p>
    </div>
  );
}
