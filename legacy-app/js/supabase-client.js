(function initializeSupabaseClient() {
  const config = window.TEAM_OPS_CONFIG || {};
  const sdk = window.supabase;
  const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey && sdk?.createClient);

  window.TeamOpsSupabase = Object.freeze({
    configured,
    client: configured ? sdk.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    }) : null,
    config
  });
})();
