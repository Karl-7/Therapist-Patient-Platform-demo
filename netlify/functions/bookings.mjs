// Booking enquiries.
//   POST  /api/bookings            anyone sends an enquiry (an account is not needed)
//   GET   /api/bookings            doctor: list all enquiries
//   PATCH /api/bookings?id=...     doctor: update { status, note }
// Blob key: "<createdISO>_<id>" in the "bookings" store.
import { createHash } from 'node:crypto'
import { cleanText, currentUser, fail, isDoctor, json, listJSON, newId, readJson, sameOrigin, store } from '../lib/common.mjs'

const STATUSES = ['new', 'contacted', 'scheduled', 'closed']
const GUEST_DAILY_LIMIT = 5 // enquiries per connection per day without an account (stops spam floods)

// Counts guest enquiries per connection. The IP address is only stored as a one-way hash.
async function guestUnderLimit(ip) {
  const usage = store('usage')
  const key = `booking-guest/${createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 32)}/${new Date().toISOString().slice(0, 10)}`
  const count = (await usage.get(key, { type: 'json' }))?.count || 0
  if (count >= GUEST_DAILY_LIMIT) return false
  await usage.setJSON(key, { count: count + 1 })
  return true
}

export default async (req, context) => {
  if (!sameOrigin(req)) return fail(403, 'Bad origin')
  const user = await currentUser()
  const bookings = store('bookings')

  if (req.method === 'POST') {
    const body = await readJson(req)
    // Hidden "website" field: people never see it, spam bots fill it in. Pretend it worked.
    if (body?.website) return json({ booking: { id: 'ok', created: new Date().toISOString() } }, 201)
    const name = cleanText(body?.name, 120)
    const email = cleanText(body?.email, 200)
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'Please add your name and a valid email.')
    if (!user && !(await guestUnderLimit(context?.ip))) {
      return fail(429, 'Too many enquiries from this connection today. Please try again tomorrow, or email support@safe-spacetherapy.com.')
    }
    const created = new Date().toISOString()
    const booking = {
      id: newId(),
      userId: user?.id || null,
      accountEmail: user?.email || '',
      guest: !user,
      name,
      email,
      service: cleanText(body?.service, 120),
      session: cleanText(body?.session, 120),
      date: /^\d{4}-\d{2}-\d{2}$/.test(body?.date) ? body.date : '',
      message: cleanText(body?.message, 4000),
      status: 'new',
      note: '',
      created,
    }
    await bookings.setJSON(`${created}_${booking.id}`, booking)
    return json({ booking: { id: booking.id, created } }, 201)
  }

  if (!user) return fail(401, 'Please sign in.')

  if (!isDoctor(user)) return fail(403, 'Doctor access only.')

  if (req.method === 'GET') {
    const items = await listJSON(bookings, '')
    items.sort((a, b) => b.created.localeCompare(a.created))
    return json({ bookings: items })
  }

  if (req.method === 'PATCH') {
    const id = new URL(req.url).searchParams.get('id')
    const { blobs } = await bookings.list()
    const hit = blobs.find((b) => b.key.endsWith(`_${id}`))
    if (!id || !hit) return fail(404, 'Booking not found')
    const body = (await readJson(req)) || {}
    const booking = await bookings.get(hit.key, { type: 'json' })
    if (STATUSES.includes(body.status)) booking.status = body.status
    if (typeof body.note === 'string') booking.note = cleanText(body.note, 2000)
    booking.updated = new Date().toISOString()
    await bookings.setJSON(hit.key, booking)
    return json({ booking })
  }

  return fail(405, 'Method not allowed')
}

export const config = { path: '/api/bookings' }
