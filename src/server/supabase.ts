// Server-side Supabase access for the Vercel functions: PostgREST with the secret key, and Auth's /user to
// check a visitor's access token. Never imported by the page.

export function supabaseServer(url: string, key: string) {
  // legacy keys are JWTs and go in both headers; new sb_secret_ keys aren't JWTs and go in `apikey` only
  const auth: Record<string, string> = key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key }

  async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...auth, 'content-type': 'application/json', ...init.headers } })
    if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`)
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  /** the GitHub user id behind a Supabase access token (from auth.identities, which users can't edit), or null */
  async function githubIdOf(accessToken: string): Promise<string | null> {
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: auth.apikey, authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return null
    const user = (await res.json()) as { identities?: { provider?: string; id?: string; identity_data?: { provider_id?: string } }[] }
    const gh = user.identities?.find((i) => i.provider === 'github')
    const id = gh?.identity_data?.provider_id ?? gh?.id
    return id ? String(id) : null
  }

  return { rest, githubIdOf }
}
