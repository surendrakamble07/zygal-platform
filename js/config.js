// Safe browser configuration. The anon key is publishable; never place service-role keys here.
window.TEAM_OPS_CONFIG = Object.freeze({
  supabaseUrl: window.TEAM_OPS_SUPABASE_URL || '',
  supabaseAnonKey: window.TEAM_OPS_SUPABASE_ANON_KEY || '',
  emailOtpEndpoint: window.TEAM_OPS_EMAIL_OTP_ENDPOINT || '',
  authRedirectTo: window.location.origin + window.location.pathname
});
