import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AuthContext, type ActionResult, type AuthContextValue, type Profile } from './auth-context'

// Remembered login: how long a browser stays signed in without any use.
const REMEMBER_DAYS = 7
const LAST_ACTIVE_KEY = 'zygal_last_active'
// Tracked session: how often we tell the database "still working".
const HEARTBEAT_MS = 2 * 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const

function touchLastActive() {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()))
  } catch {
    /* storage blocked: ignore */
  }
}

function clearLastActive() {
  try {
    localStorage.removeItem(LAST_ACTIVE_KEY)
  } catch {
    /* ignore */
  }
}

function isRememberExpired(): boolean {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_KEY)
    if (!raw) return true
    const last = Number(raw)
    if (!Number.isFinite(last)) return true
    return Date.now() - last > REMEMBER_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return true
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [profileState, setProfileState] = useState<{ userId: string; profile: Profile } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const trackingId = useRef<string | null>(null)

  // 1) Restore the saved login when the page opens, and enforce the 7-day limit.
  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      if (data.session && isRememberExpired()) {
        await supabase.auth.signOut({ scope: 'local' })
        clearLastActive()
        if (cancelled) return
        setNotice('Your saved login expired after 7 days without use. Please sign in again.')
        setSession(null)
      } else {
        setSession(data.session)
      }
      setSessionReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  // 2) Load the employee profile. Only active, pre-registered employees get in.
  const userId = session?.user.id ?? null
  useEffect(() => {
    if (!userId) return
    let cancelled = false

    ;(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, job_title, is_active')
        .eq('id', userId)
        .maybeSingle()
      if (cancelled) return

      if (error || !data || !data.is_active) {
        await supabase.auth.signOut({ scope: 'local' })
        clearLastActive()
        setNotice(
          error
            ? 'We could not verify your account. Please try again.'
            : 'This account is not active. Please contact your Admin.',
        )
        setProfileState(null)
        return
      }
      setProfileState({ userId, profile: data as Profile })
    })()

    return () => {
      cancelled = true
    }
  }, [userId])

  const profile = profileState && profileState.userId === userId ? profileState.profile : null
  const activeProfileId = profile?.id ?? null

  // 3) Login/activity tracking while the employee is working.
  useEffect(() => {
    if (!activeProfileId) return
    let stopped = false
    let lastBeat = Date.now()
    let lastActivity = Date.now()
    let lastStore = 0

    const begin = async () => {
      const { data, error } = await supabase.rpc('start_session', {
        p_user_agent: navigator.userAgent,
      })
      if (!stopped && !error && data) trackingId.current = data as string
      lastBeat = Date.now()
    }

    const beat = async () => {
      lastBeat = Date.now()
      const id = trackingId.current
      if (!id) {
        await begin()
        return
      }
      const { data, error } = await supabase.rpc('session_heartbeat', { p_session_id: id })
      if (error) return
      if (data === false) await begin() // the database closed it after idle: start a new one
    }

    const maybeBeat = () => {
      if (lastActivity > lastBeat && Date.now() - lastBeat >= HEARTBEAT_MS) void beat()
    }

    const onActivity = () => {
      const now = Date.now()
      lastActivity = now
      if (now - lastStore > 60_000) {
        lastStore = now
        touchLastActive()
      }
      maybeBeat()
    }

    void begin()
    touchLastActive()
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    const timer = window.setInterval(maybeBeat, 30_000)

    return () => {
      stopped = true
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
      window.clearInterval(timer)
    }
  }, [activeProfileId])

  const requestCode = useCallback(async (email: string): Promise<ActionResult> => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }, // never create accounts from the login page
    })
    if (!error) return { ok: true }
    // Unknown email: look exactly like success, so outsiders cannot test which emails exist.
    if (error.status === 422) return { ok: true }
    if (error.status === 429) {
      return { ok: false, message: 'Please wait a minute before asking for another code.' }
    }
    return {
      ok: false,
      message: 'We could not send the code right now. Try again in a minute, or contact your Admin.',
    }
  }, [])

  const verifyCode = useCallback(async (email: string, code: string): Promise<ActionResult> => {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) {
      return { ok: false, message: 'That code is not correct or has expired. Check the email and try again.' }
    }
    touchLastActive()
    setNotice(null)
    return { ok: true }
  }, [])

  const signOut = useCallback(async () => {
    const id = trackingId.current
    trackingId.current = null
    if (id) await supabase.rpc('end_session', { p_session_id: id }) // writes the logout time
    clearLastActive()
    await supabase.auth.signOut({ scope: 'local' }) // this browser only
  }, [])

  const status: AuthContextValue['status'] = !sessionReady
    ? 'loading'
    : !session
      ? 'signed_out'
      : profile
        ? 'signed_in'
        : 'loading'

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, profile, notice, requestCode, verifyCode, signOut }),
    [status, session, profile, notice, requestCode, verifyCode, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
