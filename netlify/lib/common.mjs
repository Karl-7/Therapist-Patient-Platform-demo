// Shared helpers for the Netlify Functions in netlify/functions.
import { getStore } from '@netlify/blobs'
import { getUser, refreshSession } from '@netlify/identity'

export const DOCTOR_ROLE = 'doctor'

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export const fail = (status, error) => json({ error }, status)

export const store = (name) => getStore({ name, consistency: 'strong' })

export const isDoctor = (user) => Array.isArray(user?.roles) && user.roles.includes(DOCTOR_ROLE)

// Returns the signed-in user (verified by Netlify Identity), or null.
export async function currentUser() {
  try {
    await refreshSession()
  } catch {
    // An expired refresh token just means "not signed in".
  }
  return getUser()
}

// Blocks writes coming from other websites (CSRF).
export function sameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  const origin = req.headers.get('origin')
  return !!origin && origin === new URL(req.url).origin
}

export async function readJson(req) {
  try {
    return await req.json()
  } catch {
    return null
  }
}

export const cleanText = (value, max) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

// Monday (UTC) of the week a date falls in, as YYYY-MM-DD.
// The browser sends its own local week; this is only the fallback.
export function weekStart(iso) {
  const d = new Date(iso)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

export const newId = () => `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`

// Weeks whose journal changed since their AI summary was written.
// Key "<userId>/<week>" in the "summary-queue" store. The AI worker empties it.
export async function markForSummary(userId, week) {
  await store('summary-queue').setJSON(`${userId}/${week}`, { userId, week, changedAt: new Date().toISOString() })
}

// Reads every JSON blob under a prefix.
export async function listJSON(s, prefix) {
  const { blobs } = await s.list({ prefix })
  const items = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })))
  return items.filter(Boolean)
}
