// Sample data for doctor.html?demo=1. Lets you see the Doctor page before any real data exists.
// Everything stays in memory; nothing is sent to the server.

const monday = (weeksAgo) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - weeksAgo * 7)
  return d
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const at = (weeksAgo, dayOffset, hour) => {
  const d = monday(weeksAgo)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, 15)
  return d.toISOString()
}

const bookings = [
  { id: 'b1', name: 'Alex Morgan', email: 'alex@example.com', session: 'Online session', date: ymd(monday(-1)), message: 'I would like to talk about work stress. Evenings suit me best.', status: 'new', note: '', created: at(0, 1, 9) },
  { id: 'b2', name: 'Sam Lee', email: 'sam@example.com', session: 'Individual session', date: '', message: '', status: 'contacted', note: 'Sent available times on Monday.', created: at(1, 3, 14) },
  { id: 'b3', name: 'Jordan Kim', email: 'jordan@example.com', session: "I'd like to discuss options", date: ymd(monday(-2)), message: 'Looking for ADHD support for my teenager.', status: 'scheduled', note: 'First session booked.', created: at(2, 2, 11) },
]

const clients = [
  { id: 'c1', name: 'Alex Morgan', email: 'alex@example.com', createdAt: at(3, 0, 10) },
  { id: 'c2', name: '', email: 'river@example.com', createdAt: at(1, 4, 18) },
]

const details = {
  c1: {
    client: clients[0],
    weeks: [
      {
        week: ymd(monday(1)),
        summary: {
          week: ymd(monday(1)),
          entryCount: 5,
          summary: 'Wrote on five days. Early in the week the entries focus on pressure at work and trouble sleeping. From Thursday the tone becomes calmer; they mention a walk with a friend and using a breathing exercise before bed.',
          comparison: 'Compared with last week: fewer mentions of feeling overwhelmed (2 vs 5) and sleep described as slightly better. Work stress remains the main theme.',
          generatedAt: at(1, 6, 20),
        },
        shared: [
          { id: 'e5', title: 'A better day', text: 'Went for a long walk with Maya after work. I noticed I was breathing more slowly afterwards. I want to keep doing this.', created: at(1, 4, 21), week: ymd(monday(1)) },
        ],
      },
      {
        week: ymd(monday(2)),
        summary: {
          week: ymd(monday(2)),
          entryCount: 4,
          summary: 'Four entries, mostly about deadlines, feeling behind and waking up at night. One entry mentions skipping meals on busy days.',
          comparison: 'First week with entries, so there is nothing to compare yet.',
          generatedAt: at(2, 6, 20),
        },
        shared: [],
      },
    ],
  },
  c2: { client: clients[1], weeks: [{ week: ymd(monday(0)), summary: null, shared: [{ id: 'e9', title: '', text: 'First time writing here. Not sure what to say yet, but it feels good to start.', created: at(0, 2, 22), week: ymd(monday(0)) }] }] },
}

let affirmations = null

const clone = (x) => JSON.parse(JSON.stringify(x))

export async function demoApi(path, { method = 'GET', body } = {}) {
  await new Promise((r) => setTimeout(r, 150))
  const url = new URL(path, location.origin)
  if (url.pathname === '/api/bookings') {
    if (method === 'PATCH') {
      const b = bookings.find((x) => x.id === url.searchParams.get('id'))
      Object.assign(b, body)
      return { booking: clone(b) }
    }
    return { bookings: clone(bookings) }
  }
  if (url.pathname === '/api/doctor/clients') return { clients: clone(clients) }
  if (url.pathname.startsWith('/api/doctor/clients/')) return clone(details[url.pathname.split('/').pop()])
  if (url.pathname === '/api/affirmations') {
    if (method === 'PUT') {
      affirmations = clone(body.items)
      return { items: clone(affirmations), updated: new Date().toISOString() }
    }
    if (!affirmations) {
      affirmations = [
        { id: 'a1', category: 'Stress & Anxiety', tags: ['anxious', 'calm', 'breathing'], text: 'I can take one slow breath at a time. I do not have to solve everything right now.' },
        { id: 'a4', category: 'Self-Compassion', tags: ['sad', 'kindness', 'gentle'], text: 'It is okay to feel what I feel. I can meet myself with kindness today.' },
        { id: 'a6', category: 'Mindfulness', tags: ['present', 'mindful', 'now'], text: 'I can return to this moment, gently, without needing to change anything.' },
      ]
    }
    return { items: clone(affirmations), updated: null, isDefault: true }
  }
  throw new Error('Not available in the preview')
}
