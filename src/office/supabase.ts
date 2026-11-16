// The page's one Supabase client (read-only publishable key): Realtime status (#1), the approval count, and the
// owner's GitHub sign-in (#25). null when the office isn't configured (local development).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { roomAfterSignIn } from './approval/signInFlow'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/**
 * #597 a sign-in begun in the desk room's frame came back to the office in the top window: where to go back to (the room) once the session is
 * taken. Read before the client takes the answer out of the address.
 */
export const roomAfterAuth: string | null =
  typeof window === 'undefined' ? null : roomAfterSignIn({ top: window.top === window.self, href: window.location.href })

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
