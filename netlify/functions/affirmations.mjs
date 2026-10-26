// Affirmation library shown on the site.
//   GET /api/affirmations   anyone: current list (falls back to the starter list)
//   PUT /api/affirmations   doctor: replace the whole list { items: [...] }
import { cleanText, currentUser, fail, isDoctor, json, readJson, sameOrigin, store } from '../lib/common.mjs'
import { DEFAULT_AFFIRMATIONS } from '../lib/default-affirmations.mjs'

const KEY = 'affirmations'

export default async (req) => {
  if (!sameOrigin(req)) return fail(403, 'Bad origin')
  const site = store('site')

  if (req.method === 'GET') {
    const saved = await site.get(KEY, { type: 'json' })
    return json({ items: saved?.items ?? DEFAULT_AFFIRMATIONS, updated: saved?.updated ?? null, isDefault: !saved })
  }

  if (req.method === 'PUT') {
    const user = await currentUser()
    if (!user) return fail(401, 'Please sign in.')
    if (!isDoctor(user)) return fail(403, 'Doctor access only.')
    const body = await readJson(req)
    if (!Array.isArray(body?.items)) return fail(400, 'Expected { items: [...] }')
    const seen = new Set()
    const items = body.items
      .map((x, i) => ({
        id: cleanText(x?.id, 60) || `a${Date.now().toString(36)}${i}`,
        category: cleanText(x?.category, 80) || 'General',
        tags: (Array.isArray(x?.tags) ? x.tags : []).map((t) => cleanText(t, 40).toLowerCase()).filter(Boolean).slice(0, 12),
        text: cleanText(x?.text, 600),
      }))
      .filter((x) => x.text && !seen.has(x.id) && seen.add(x.id))
      .slice(0, 500)
    const saved = { items, updated: new Date().toISOString(), updatedBy: user.email || user.id }
    await site.setJSON(KEY, saved)
    return json(saved)
  }

  return fail(405, 'Method not allowed')
}

export const config = { path: '/api/affirmations' }
