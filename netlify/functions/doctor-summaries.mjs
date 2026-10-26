// Doctor side of the AI weekly summaries.
//   POST /api/doctor/summaries/refresh  { clientId }   start the AI server if any week needs a summary
//   GET  /api/doctor/summaries/status?clientId=...     progress for the Doctor page
//
// Starting the server needs these Netlify environment variables (see README.md):
//   SUMMARY_EC2_INSTANCE_ID, SUMMARY_EC2_REGION, SUMMARY_AWS_ACCESS_KEY_ID, SUMMARY_AWS_SECRET_ACCESS_KEY
import { EC2Client, StartInstancesCommand } from '@aws-sdk/client-ec2'
import { currentUser, fail, isDoctor, json, readJson, sameOrigin } from '../lib/common.mjs'
import { isActive, queuedItems, readJob, writeJob } from '../lib/summary-job.mjs'

const configured = () =>
  !!(process.env.SUMMARY_EC2_INSTANCE_ID && process.env.SUMMARY_EC2_REGION && process.env.SUMMARY_AWS_ACCESS_KEY_ID && process.env.SUMMARY_AWS_SECRET_ACCESS_KEY)

async function startServer() {
  const ec2 = new EC2Client({
    region: process.env.SUMMARY_EC2_REGION,
    credentials: { accessKeyId: process.env.SUMMARY_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.SUMMARY_AWS_SECRET_ACCESS_KEY },
  })
  await ec2.send(new StartInstancesCommand({ InstanceIds: [process.env.SUMMARY_EC2_INSTANCE_ID] }))
}

async function status(clientId) {
  const [job, items] = await Promise.all([readJob(), queuedItems()])
  const active = isActive(job)
  return {
    state: !configured() ? 'not-configured' : active ? job.state : job.lastError && !items.length ? 'error' : items.length ? 'waiting' : 'idle',
    pending: items.length,
    pendingForClient: clientId ? items.filter((i) => i.userId === clientId).length : undefined,
    requestedAt: job.requestedAt || null,
    finishedAt: job.finishedAt || null,
    lastError: job.lastError || null,
  }
}

export default async (req, context) => {
  if (!sameOrigin(req)) return fail(403, 'Bad origin')
  const user = await currentUser()
  if (!user) return fail(401, 'Please sign in.')
  if (!isDoctor(user)) return fail(403, 'Doctor access only.')
  const action = context.params?.action

  if (action === 'status' && req.method === 'GET') {
    return json(await status(new URL(req.url).searchParams.get('clientId')))
  }

  if (action === 'refresh' && req.method === 'POST') {
    const body = await readJson(req)
    const clientId = typeof body?.clientId === 'string' ? body.clientId.slice(0, 100) : null
    return json(await refresh(clientId))
  }

  return fail(405, 'Method not allowed')
}

async function refresh(clientId) {
  if (!configured()) return status(clientId)
  const items = await queuedItems()
  if (!items.length) return status(clientId)

  const job = await readJob()
  const now = new Date().toISOString()
  if (isActive(job)) {
    // Already working: just move this person to the front.
    if (clientId && !job.priority?.includes(clientId)) await writeJob({ ...job, priority: [clientId, ...(job.priority || [])] })
    return status(clientId)
  }

  await writeJob({ state: 'starting', priority: clientId ? [clientId] : [], requestedAt: now, lastSeen: now, lastError: null })
  try {
    await startServer()
  } catch (err) {
    await writeJob({ state: 'idle', priority: [], requestedAt: now, finishedAt: now, lastError: `Could not start the AI server: ${err.message}` })
  }
  return status(clientId)
}

export const config = { path: '/api/doctor/summaries/:action' }
