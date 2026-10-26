// Private user's own journal entries.
//   GET    /api/journals            list my entries
//   POST   /api/journals            create { title, text, shared, week }
//   PATCH  /api/journals?id=...     update { shared } (and/or title, text)
//   DELETE /api/journals?id=...     delete one entry
// Blob key: "<userId>/<entryId>" in the "journals" store.
import { cleanText, currentUser, fail, isDoctor, json, listJSON, markForSummary, newId, readJson, sameOrigin, store, weekStart } from '../lib/common.mjs'

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/

export default async (req) => {
  if (!sameOrigin(req)) return fail(403, 'Bad origin')
  const user = await currentUser()
  if (!user) return fail(401, 'Please sign in.')
  if (isDoctor(user)) return fail(403, 'Doctor accounts do not keep a journal.')

  const journals = store('journals')
  const id = new URL(req.url).searchParams.get('id')
  const key = id ? `${user.id}/${id}` : null

  if (req.method === 'GET') {
    const entries = await listJSON(journals, `${user.id}/`)
    entries.sort((a, b) => b.created.localeCompare(a.created))
    return json({ entries })
  }

  if (req.method === 'POST') {
    const body = await readJson(req)
    const text = cleanText(body?.text, 20000)
    if (!text) return fail(400, 'Write a little note before saving.')
    const created = typeof body?.created === 'string' && !Number.isNaN(Date.parse(body.created)) ? body.created : new Date().toISOString()
    const entry = {
      id: newId(),
      userId: user.id,
      title: cleanText(body?.title, 200),
      text,
      shared: body?.shared === true,
      created,
      week: WEEK_RE.test(body?.week) ? body.week : weekStart(created),
    }
    await journals.setJSON(`${user.id}/${entry.id}`, entry)
    await markForSummary(user.id, entry.week)
    return json({ entry }, 201)
  }

  if (!key) return fail(400, 'Missing id')
  const existing = await journals.get(key, { type: 'json' })
  if (!existing) return fail(404, 'Entry not found')

  if (req.method === 'PATCH') {
    const body = (await readJson(req)) || {}
    const entry = { ...existing, updated: new Date().toISOString() }
    if (typeof body.shared === 'boolean') entry.shared = body.shared
    if (typeof body.title === 'string') entry.title = cleanText(body.title, 200)
    if (typeof body.text === 'string' && body.text.trim()) entry.text = cleanText(body.text, 20000)
    await journals.setJSON(key, entry)
    if (entry.text !== existing.text || entry.title !== existing.title) await markForSummary(user.id, entry.week)
    return json({ entry })
  }

  if (req.method === 'DELETE') {
    await journals.delete(key)
    await markForSummary(user.id, existing.week)
    return json({ ok: true })
  }

  return fail(405, 'Method not allowed')
}

export const config = { path: '/api/journals' }
