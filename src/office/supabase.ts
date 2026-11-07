// The page's one Supabase client (read-only publishable key): Realtime status (#1), the approval count, and the
// owner's GitHub sign-in (#25). null when the office isn't configured (local development).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
