// Booking enquiries.
//   POST  /api/bookings            signed-in Private user sends an enquiry
//   GET   /api/bookings            doctor: list all enquiries
//   PATCH /api/bookings?id=...     doctor: update { status, note }
// Blob key: "<createdISO>_<id>" in the "bookings" store.
import { cleanText, currentUser, fail, isDoctor, json, listJSON, newId, readJson, sameOrigin, store } from '../lib/common.mjs'

const STATUSES = ['new', 'contacted', 'scheduled', 'closed']

export default async (req) => {
  if (!sameOrigin(req)) return fail(403, 'Bad origin')
  const user = await currentUser()
  if (!user) return fail(401, 'Please sign in.')
  const bookings = store('bookings')

  if (req.method === 'POST') {
    const body = await readJson(req)
    const name = cleanText(body?.name, 120)
    const email = cleanText(body?.email, 200)
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'Please add your name and a valid email.')
    const created = new Date().toISOString()
    const booking = {
      id: newId(),
      userId: user.id,
      accountEmail: user.email || '',
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
