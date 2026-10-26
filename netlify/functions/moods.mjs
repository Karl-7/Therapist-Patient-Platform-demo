// POST /api/moods  { mood, date, week, created }
// Counts one tap on a mood for that (local) day. Stored as a hidden journal item
// "<userId>/mood-<date>" (kind "mood") that the person never sees in their journal list.
// The weekly AI summary reads it as the first line of that day.
import { currentUser, fail, isDoctor, json, markForSummary, readJson, sameOrigin, store, weekStart } from '../lib/common.mjs'
import { MOOD_NAMES, moodSentence } from '../lib/moods.mjs'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export default async (req) => {
  if (req.method !== 'POST') return fail(405, 'Method not allowed')
  if (!sameOrigin(req)) return fail(403, 'Bad origin')
  const user = await currentUser()
  if (!user) return fail(401, 'Please sign in.')
  if (isDoctor(user)) return fail(403, 'Mood check-ins are for Private accounts.')

  const body = await readJson(req)
  const mood = MOOD_NAMES.find((m) => m === body?.mood)
  if (!mood) return fail(400, 'Unknown mood')
  const date = DAY_RE.test(body?.date) ? body.date : new Date().toISOString().slice(0, 10)
  const created = typeof body?.created === 'string' && !Number.isNaN(Date.parse(body.created)) ? body.created : `${date}T00:00:00.000Z`
  const week = DAY_RE.test(body?.week) ? body.week : weekStart(created)

  const journals = store('journals')
  const key = `${user.id}/mood-${date}`
  const day = (await journals.get(key, { type: 'json' })) || { id: `mood-${date}`, userId: user.id, kind: 'mood', date, counts: {}, order: [], title: '', shared: false, created, week }
  day.counts[mood] = (day.counts[mood] || 0) + 1
  if (!day.order.includes(mood)) day.order.push(mood)
  day.text = moodSentence(day.counts, day.order)
  day.updated = new Date().toISOString()
  await journals.setJSON(key, day)
  await markForSummary(user.id, day.week)
  // The sentence itself is not sent back: the person does not see it.
  return json({ ok: true })
}

export const config = { path: '/api/moods' }
