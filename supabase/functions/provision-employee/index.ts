import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!supabaseUrl || !serviceRoleKey || !authorization) return json({ error: 'Authentication is not configured.' }, 500);

  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || serviceRoleKey, {
    global: { headers: { Authorization: authorization } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Authentication required.' }, 401);

  const { data: caller, error: callerError } = await adminClient
    .from('profiles')
    .select('id, role:roles(name)')
    .eq('id', user.id)
    .single();
  const callerRole = (caller?.role as { name?: string } | null)?.name;
  if (callerError || !['Admin', 'Assistant Manager', 'Team Lead'].includes(callerRole || '')) {
    return json({ error: 'Only administrators can manage employees.' }, 403);
  }

  const input = await request.json();
  const email = String(input.email || '').trim().toLowerCase();
  const fullName = String(input.fullName || input.name || '').trim();
  const employeeId = String(input.employeeId || input.loginId || '').trim();
  const designation = String(input.designation || '').trim();
  const accessRoleName = String(input.accessRole || input.role || 'Employee').trim();
  const status = String(input.status || 'Active').trim();

  if (!fullName || !employeeId || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Name, employee ID, and a valid email are required.' }, 400);
  if (!['Employee', 'Team Lead', 'Assistant Manager', 'Admin'].includes(accessRoleName)) return json({ error: 'Invalid employee role.' }, 400);
  if (!['Active', 'Inactive', 'Suspended'].includes(status)) return json({ error: 'Invalid employee status.' }, 400);
  if (callerRole === 'Team Lead' && !['Employee', 'Team Lead'].includes(accessRoleName)) {
    return json({ error: 'Team Leads can only assign the Employee or Team Lead role.' }, 403);
  }

  const { data: role, error: roleError } = await adminClient.from('roles').select('id').eq('name', accessRoleName).single();
  if (roleError || !role) return json({ error: 'The selected role is not configured.' }, 400);

  const existingQuery = adminClient.from('profiles').select('id, email');
  const profileId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(input.profileId || '')) ? input.profileId : '';
  const { data: existing, error: existingError } = profileId
    ? await existingQuery.eq('id', profileId).maybeSingle()
    : { data: null, error: null };
  if (existingError) return json({ error: 'Could not load the employee profile.' }, 500);

  const { data: duplicate } = await adminClient
    .from('profiles')
    .select('id')
    .eq('email_normalized', email)
    .neq('id', existing?.id || '00000000-0000-0000-0000-000000000000')
    .maybeSingle();
  if (duplicate) return json({ error: 'This authorized email is already assigned to another employee.' }, 409);

  let authUserId = existing?.id;
  if (authUserId) {
    const { error } = await adminClient.auth.admin.updateUserById(authUserId, { email, email_confirm: false });
    if (error) return json({ error: 'Could not update the employee Auth identity.' }, 400);
  } else {
    const { data, error } = await adminClient.auth.admin.createUser({ email, email_confirm: false });
    if (error || !data.user) return json({ error: error?.message || 'Could not create the employee Auth identity.' }, 400);
    authUserId = data.user.id;
  }

  const profile = {
    id: authUserId,
    full_name: fullName,
    email,
    employee_id: employeeId,
    role_id: role.id,
    department: String(input.department || '').trim() || null,
    project: String(input.project || '').trim() || null,
    designation: designation || null,
    mobile: String(input.mobile || '').replace(/\D/g, '') || null,
    status,
    email_verified: existing?.email === email ? Boolean(input.emailVerified) : false,
    created_by: existing ? undefined : user.id,
    updated_at: new Date().toISOString()
  };
  const { data: saved, error: profileError } = await adminClient.from('profiles').upsert(profile).select('id, full_name, email, employee_id, status').single();
  if (profileError) {
    if (!existing?.id && authUserId) await adminClient.auth.admin.deleteUser(authUserId);
    return json({ error: 'The employee profile could not be saved.' }, 500);
  }
  return json({ profile: saved });
});