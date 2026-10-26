// State of the AI summary job, shared by doctor-summaries.mjs and worker.mjs.
//
// How it works:
// 1. Journal changes put "<userId>/<week>" into the "summary-queue" store.
// 2. When a doctor opens a person, /api/doctor/summaries/refresh starts the EC2 server (if anything is queued).
// 3. The server boots, its worker asks /api/worker/* for queued weeks, writes summaries, then powers off.
import { store } from './common.mjs'

const JOB_KEY = 'summary-job'
// If the server has not checked in for this long, assume it stopped and allow a new start.
export const STALE_MS = 15 * 60 * 1000

export const queueStore = () => store('summary-queue')

export async function readJob() {
  return (await store('site').get(JOB_KEY, { type: 'json' })) || { state: 'idle', priority: [] }
}

export async function writeJob(job) {
  await store('site').setJSON(JOB_KEY, job)
  return job
}

export function isActive(job, now = Date.now()) {
  if (job.state !== 'starting' && job.state !== 'running') return false
  const last = Date.parse(job.lastSeen || job.requestedAt || 0)
  return now - last < STALE_MS
}

export async function queuedItems() {
  const { blobs } = await queueStore().list()
  return blobs.map((b) => {
    const [userId, week] = b.key.split('/')
    return { key: b.key, userId, week }
  })
}

// Monday 7 days earlier (YYYY-MM-DD).
export function previousWeek(week) {
  const d = new Date(week + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 7)
  return d.toISOString().slice(0, 10)
}
