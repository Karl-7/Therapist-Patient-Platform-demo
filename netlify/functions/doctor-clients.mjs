// Doctor view of Private users.
//   GET /api/doctor/clients        list Private accounts
//   GET /api/doctor/clients/:id    one person's weekly AI summaries + the entries they chose to share + doctor notes
//   PUT /api/doctor/clients/:id/notes   { symptoms }   save the doctor's own notes about this person
//
// The doctor never receives entries that were not shared. Weekly summaries are written by the
// AI worker (ai-worker/) under "<userId>/<weekMonday YYYY-MM-DD>". See README.md.
import { admin } from '@netlify/identity'
import { cleanText, currentUser, fail, isDoctor, json, listJSON, readJson, sameOrigin, store } from '../lib/common.mjs'

async function allUsers() {
  const users = []
  for (let page = 1; page <= 20; page++) {
    const batch = await admin.listUsers({ page, perPage: 100 })
    users.push(...batch)
    if (batch.length < 100) break
  }
  return users
}

export default async (req, context) => {
  if (!sameOrigin(req)) return fail(403, 'Bad origin')
  const user = await currentUser()
  if (!user) return fail(401, 'Please sign in.')
  if (!isDoctor(user)) return fail(403, 'Doctor access only.')

  const id = context.params?.id

  // Doctor's own notes (only doctors can read them).
  if (id && new URL(req.url).pathname.endsWith('/notes')) {
    if (req.method !== 'PUT') return fail(405, 'Method not allowed')
    const body = await readJson(req)
    const notes = { symptoms: cleanText(body?.symptoms, 20000), updated: new Date().toISOString(), updatedBy: user.email || user.id }
    await store('doctor-notes').setJSON(id, notes)
    return json({ notes })
  }
  if (req.method !== 'GET') return fail(405, 'Method not allowed')

  if (!id) {
    const users = (await allUsers()).filter((u) => !isDoctor(u))
    const clients = users.map((u) => ({ id: u.id, name: u.name || '', email: u.email || '', createdAt: u.createdAt || null }))
    clients.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
    return json({ clients })
  }

  let client
  try {
    client = await admin.getUser(id)
  } catch {
    return fail(404, 'Not found')
  }
  if (isDoctor(client)) return fail(404, 'Not found')

  const [all, summaries, queued, notes] = await Promise.all([
    listJSON(store('journals'), `${id}/`),
    listJSON(store('summaries'), `${id}/`),
    store('summary-queue').list({ prefix: `${id}/` }),
    store('doctor-notes').get(id, { type: 'json' }),
  ])
  const waiting = new Set(queued.blobs.map((b) => b.key.split('/')[1]))
  const shared = all
    .filter((e) => e.shared === true)
    .map(({ id: entryId, title, text, created, week }) => ({ id: entryId, title, text, created, week }))

  // Group by week, newest first.
  const weeks = new Map()
  const slot = (w) => weeks.get(w) || weeks.set(w, { week: w, summary: null, shared: [], waiting: waiting.has(w) }).get(w)
  summaries.forEach((s) => s?.week && (slot(s.week).summary = s))
  shared.forEach((e) => slot(e.week).shared.push(e))
  waiting.forEach((w) => slot(w)) // weeks with entries that are not summarised yet
  const list = [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week))
  list.forEach((w) => w.shared.sort((a, b) => a.created.localeCompare(b.created)))

  return json({
    client: { id: client.id, name: client.name || '', email: client.email || '', createdAt: client.createdAt || null },
    weeks: list,
    notes: notes || { symptoms: '' },
  })
}

export const config = { path: ['/api/doctor/clients', '/api/doctor/clients/:id', '/api/doctor/clients/:id/notes'] }
