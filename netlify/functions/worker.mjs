// Endpoints for the AI summary worker on the EC2 server (ai-worker/worker.mjs).
// Every request must carry the header  x-worker-key: <SUMMARY_WORKER_KEY>  (a Netlify environment variable).
//   POST /api/worker/begin                    -> { requested }   was the server started by a doctor?
//   POST /api/worker/next     { exclude }      -> { item, entries, earlier } or { done: true }
//   POST /api/worker/summary  { userId, week, changedAt, mood, summary, comparison, changes, entryCount }
//   POST /api/worker/end      { error }
import { timingSafeEqual } from 'node:crypto'
import { cleanText, fail, json, listJSON, readJson, store } from '../lib/common.mjs'
import { isActive, previousWeek, queueStore, queuedItems, readJob, writeJob } from '../lib/summary-job.mjs'

function authorized(req) {
  const expected = process.env.SUMMARY_WORKER_KEY || ''
  const given = req.headers.get('x-worker-key') || ''
  if (expected.length < 32 || given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

const touch = async (patch = {}) => writeJob({ ...(await readJob()), ...patch, lastSeen: new Date().toISOString() })

export default async (req, context) => {
  if (req.method !== 'POST') return fail(405, 'Method not allowed')
  if (!authorized(req)) return fail(401, 'Unauthorized')
  const body = (await readJson(req)) || {}
  const action = context.params?.action

  if (action === 'begin') {
    const job = await readJob()
    // Started from the AWS console for maintenance (not by a doctor): the worker will not power off.
    const requested = job.state === 'starting' || isActive(job)
    if (requested) await touch({ state: 'running', startedAt: new Date().toISOString(), done: 0 })
    return json({ requested })
  }

  if (action === 'next') {
    const job = await touch({ state: 'running' })
    const exclude = new Set(Array.isArray(body.exclude) ? body.exclude : [])
    const priority = job.priority || []
    const items = (await queuedItems()).filter((i) => !exclude.has(i.key))
    if (!items.length) return json({ done: true })
    // People the doctor is looking at first; older weeks first so each summary can compare with the one before.
    const rank = (i) => (priority.includes(i.userId) ? priority.indexOf(i.userId) : priority.length)
    items.sort((a, b) => rank(a) - rank(b) || a.userId.localeCompare(b.userId) || a.week.localeCompare(b.week))
    const item = items[0]
    const queued = await queueStore().get(item.key, { type: 'json' })
    const entries = (await listJSON(store('journals'), `${item.userId}/`))
      .filter((e) => e.week === item.week)
      .sort((a, b) => a.created.localeCompare(b.created))
      .map(({ created, title, text }) => ({ created, title, text }))
    // Up to three earlier weeks, most recent first, for the comparison and the "changes" list.
    const earlier = []
    let w = item.week
    for (let n = 0; n < 3; n++) {
      w = previousWeek(w)
      const s = await store('summaries').get(`${item.userId}/${w}`, { type: 'json' })
      if (s) earlier.push({ week: s.week, mood: s.mood ?? null, summary: s.summary })
    }
    return json({ item: { ...item, changedAt: queued?.changedAt || null }, entries, earlier, remaining: items.length })
  }

  if (action === 'summary') {
    const userId = cleanText(body.userId, 100)
    const week = /^\d{4}-\d{2}-\d{2}$/.test(body.week) ? body.week : null
    if (!userId || !week) return fail(400, 'Missing userId or week')
    const key = `${userId}/${week}`
    const summaries = store('summaries')
    if (!body.entryCount) {
      await summaries.delete(key) // every entry of that week was deleted
    } else {
      await summaries.setJSON(key, {
        userId,
        week,
        mood: Number.isFinite(Number(body.mood)) ? Math.min(10, Math.max(1, Math.round(Number(body.mood)))) : null,
        summary: cleanText(body.summary, 2000),
        comparison: cleanText(body.comparison, 1000),
        changes: (Array.isArray(body.changes) ? body.changes : []).map((c) => cleanText(String(c), 300)).filter(Boolean).slice(0, 5),
        entryCount: Number(body.entryCount) || 0,
        generatedAt: new Date().toISOString(),
        model: cleanText(body.model, 80),
      })
    }
    // Leave it queued if the person changed that week again while we were summarising.
    const queued = await queueStore().get(key, { type: 'json' })
    if (queued && queued.changedAt === body.changedAt) await queueStore().delete(key)
    const job = await readJob()
    await touch({ done: (job.done || 0) + 1 })
    return json({ ok: true })
  }

  if (action === 'end') {
    await writeJob({ ...(await readJob()), state: 'idle', priority: [], finishedAt: new Date().toISOString(), lastError: body.error ? cleanText(String(body.error), 500) : null })
    return json({ ok: true })
  }

  return fail(404, 'Unknown action')
}

export const config = { path: '/api/worker/:action' }
