// #597 the owner's sign-in (the key rack, the approval box) from inside the desk room's frame. GitHub refuses to be shown in a frame
// (X-Frame-Options: deny, frame-ancestors 'none'), so a sign-in started in the frame went white. Inside a frame the sign-in now runs in the
// top window, and comes back to the office's own address as before (`/rooms/office/app/?embed=room`, the same redirect as ever). Landing
// there in the top window with the sign-in's answer, the office takes the session (the same origin as the room: the frame shares it) and goes
// back to the room around it.

/** the window as these rules see it */
export interface Win {
  /** this window is the top one (not in a frame) */
  top: boolean
  href: string
}

/** how a sign-in goes from here: in this window, or (in a frame) in the top one; it comes back to this address either way */
export function signInPlan(w: Win): { where: 'here' | 'top'; redirectTo: string } {
  return { where: w.top ? 'here' : 'top', redirectTo: w.href }
}

/** the sign-in's answer in an address: the implicit flow's tokens or error in the hash, or a code / error in the query */
export function hasAuthAnswer(href: string): boolean {
  const u = new URL(href)
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''))
  return hash.has('access_token') || hash.has('error') || hash.has('error_description') || u.searchParams.has('code') || u.searchParams.has('error')
}

/**
 * Where to go once the sign-in's answer is taken: the room around the office (the office's parent path), when the office was opened for the
 * room (`?embed=room`) but stands in the top window with an answer in its address; null otherwise (stay).
 */
export function roomAfterSignIn(w: Win): string | null {
  if (!w.top) return null
  const u = new URL(w.href)
  if (u.searchParams.get('embed') !== 'room' || !hasAuthAnswer(w.href)) return null
  return new URL('../', `${u.origin}${u.pathname}`).href
}
