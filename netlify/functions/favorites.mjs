// Saved affirmations ("Your Favorites"), kept in the person's account.
//   GET    /api/favorites          -> { items }
//   POST   /api/favorites          { id, text, category }  save one
//   DELETE /api/favorites?id=...   remove one
// Blob key: "<userId>" in the "favorites" store.
import { cleanText, currentUser, fail, isDoctor, json, readJson, sameOrigin, store } from '../lib/common.mjs'

const MAX = 300

export default async (req) => {
  if (!sameOrigin(req)) return fail(403, 'Bad origin')
  const user = await currentUser()
  if (!user) return fail(401, 'Please sign in.')
  if (isDoctor(user)) return fail(403, 'Favorites are for Private accounts.')

  const favorites = store('favorites')
  const items = (await favorites.get(user.id, { type: 'json' }))?.items || []

  if (req.method === 'GET') return json({ items })

  if (req.method === 'POST') {
    const body = await readJson(req)
    const item = { id: cleanText(body?.id, 80), text: cleanText(body?.text, 600), category: cleanText(body?.category, 80), savedAt: new Date().toISOString() }
    if (!item.id || !item.text) return fail(400, 'Missing affirmation')
    const next = [item, ...items.filter((x) => x.id !== item.id)].slice(0, MAX)
    await favorites.setJSON(user.id, { items: next })
    return json({ items: next }, 201)
  }

  if (req.method === 'DELETE') {
    const id = new URL(req.url).searchParams.get('id')
    const next = items.filter((x) => x.id !== id)
    await favorites.setJSON(user.id, { items: next })
    return json({ items: next })
  }

  return fail(405, 'Method not allowed')
}

export const config = { path: '/api/favorites' }
