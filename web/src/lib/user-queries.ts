import { supabase } from './supabase'

// Calls the provision-employee Edge Function with the current person's own
// login token, so the function can check they are really an Admin.
export async function callProvision<T extends { ok?: boolean; error?: string }>(
  body: Record<string, unknown>,
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Not signed in.')

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provision-employee`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  let json: T
  try {
    json = (await res.json()) as T
  } catch {
    throw new Error('The server did not respond correctly. Please try again.')
  }
  if (!res.ok || json.error) throw new Error(json.error ?? 'Something went wrong.')
  return json
}
