(function createAuthAdapter() {
  const getBackend = () => window.TeamOpsSupabase;

  async function loadProfile(userId) {
    const backend = getBackend();
    const { data, error } = await backend.client
      .from('profiles')
      .select('id, full_name, employee_id, email, mobile, department, project, designation, status, email_verified, last_login_at, role:roles(name)')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return { ...data, role: data.role?.name || '' };
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  async function requestOtp(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Error('Enter your authorized email.');
    const backend = getBackend();
    if (!backend.configured) {
      throw new Error('Email delivery is not configured for local development. Connect Supabase Auth or an email OTP endpoint.');
    }
    const { data: authorization, error: authorizationError } = await backend.client.rpc('request_email_otp', { requested_email: normalizedEmail });
    if (authorizationError) throw authorizationError;
    if (authorization === 'NOT_FOUND') throw new Error('Access denied. This email is not authorized by your administrator.');
    if (authorization === 'INACTIVE') throw new Error('Your account is currently inactive. Please contact your administrator.');
    if (authorization === 'SUSPENDED') throw new Error('Your account has been suspended. Please contact your administrator.');

    try {
      const { error } = await backend.client.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) {
        if (error.code === 'unexpected_failure' || /magic link email|sending.*email/i.test(error.message || '')) {
          throw new Error('Supabase Auth email delivery is not configured. Enable Email sign-in and SMTP in the Supabase dashboard, then retry.');
        }
        throw error;
      }
      return { email: normalizedEmail };
    } catch (error) {
      if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && /magic link email|sending.*email/i.test(error.message)) {
        throw new Error('Supabase Auth email delivery is not configured. Enable Email sign-in and SMTP in the Supabase dashboard, then retry.');
      }
      throw error;
    }
  }

  async function verifyOtp(email, token) {
    const normalizedEmail = normalizeEmail(email);
    const backend = getBackend();
    if (!backend.configured) throw new Error('Email delivery is not configured for local development.');
    const { data, error } = await backend.client.auth.verifyOtp({ email: normalizedEmail, token: String(token || '').trim(), type: 'email' });
    if (error) throw error;
    let profile;
    try {
      profile = await loadProfile(data.user.id);
    } catch (profileError) {
      await backend.client.auth.signOut();
      throw profileError;
    }
    if (profile.status !== 'Active') {
      await backend.client.auth.signOut();
      throw new Error(profile.status === 'Suspended' ? 'Your account has been suspended. Please contact your administrator.' : 'Your account is currently inactive. Please contact your administrator.');
    }
    const { error: profileError } = await backend.client.rpc('mark_email_verified');
    if (profileError) {
      await backend.client.auth.signOut();
      throw profileError;
    }
    profile.email_verified = true;
    profile.last_login_at = new Date().toISOString();
    return { user: data.user, profile };
  }

  async function provisionEmployee(employee) {
    const backend = getBackend();
    if (!backend.configured) throw new Error('Supabase is not configured.');
    const { data, error } = await backend.client.functions.invoke('provision-employee', {
      body: employee
    });
    if (error) throw error;
    return data;
  }

  async function restoreSession() {
    const backend = getBackend();
    if (!backend.configured) return null;
    const { data, error } = await backend.client.auth.getSession();
    if (error) throw error;
    if (!data.session) return null;
    try {
      const profile = await loadProfile(data.session.user.id);
      if (profile.status !== 'Active') {
        await backend.client.auth.signOut();
        return null;
      }
      return { user: data.session.user, profile };
    } catch (profileError) {
      await backend.client.auth.signOut();
      throw profileError;
    }
  }

  async function signOut() {
    const backend = getBackend();
    if (backend.configured) {
      const { error } = await backend.client.auth.signOut();
      if (error) throw error;
    }
  }

  function onAuthStateChange(handler) {
    const backend = getBackend();
    if (!backend.configured) return { data: { subscription: { unsubscribe() {} } } };
    return backend.client.auth.onAuthStateChange(handler);
  }

  window.TeamOpsAuth = Object.freeze({ configured: () => Boolean(getBackend()?.configured), normalizeEmail, requestOtp, verifyOtp, provisionEmployee, restoreSession, signOut, onAuthStateChange });
})();
