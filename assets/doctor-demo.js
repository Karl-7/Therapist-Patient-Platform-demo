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

// Six summarised weeks for Alex (oldest first in this list), newest week still waiting.
const ALEX_WEEKS = [
  { ago: 6, mood: 4, summary: 'Wrote about feeling behind at work and waking up at night. Mentions skipping lunch on busy days and feeling irritable with family.', comparison: 'First week with entries.' },
  { ago: 5, mood: 3, summary: 'A hard week. Several entries about deadlines, poor sleep and feeling alone with the workload. One entry mentions crying after a meeting.', comparison: 'Lower mood than the week before; sleep described as worse.' },
  { ago: 4, mood: 5, summary: 'Mixed week. Work stress continues but they describe a good weekend with a friend and trying a breathing exercise before bed.', comparison: 'Somewhat better; first mention of a coping strategy.' },
  { ago: 3, mood: 6, summary: 'Steadier. Talks about setting a limit on evening emails and sleeping a little better. Still worried about an upcoming review.', comparison: 'Improvement continues; fewer entries about sleep.' },
  { ago: 2, mood: 5, summary: 'The performance review went less well than hoped. Frustration and self-criticism, but they also note reaching out to a colleague for support.', comparison: 'A small dip after the review, but less overwhelmed than four weeks ago.' },
  { ago: 1, mood: 7, summary: 'Calmer week. Long walks, dinner with a friend, and using the breathing exercise most nights. Work is still busy but described as manageable.', comparison: 'Best week so far; sleep and mood both described as better.' },
]
const alexWeeks = ALEX_WEEKS.map((w) => ({
  week: ymd(monday(w.ago)),
  waiting: false,
  summary: {
    week: ymd(monday(w.ago)), mood: w.mood, summary: w.summary, comparison: w.comparison, entryCount: 4 + (w.ago % 3),
    generatedAt: at(w.ago, 6, 20),
    changes: w.ago === 1 ? [
      'Mood highest so far (7/10), up from 5–6 in the previous three weeks.',
      'Sleep described as better on most nights; no night waking mentioned.',
      'Uses the breathing exercise regularly now, not just occasionally.',
      'Work stress still present but no longer the main theme.',
    ] : [],
  },
  shared: w.ago === 1 ? [
    { id: 'e1', title: 'Monday', text: 'Long walk after work. I noticed I was breathing more slowly afterwards.', created: at(1, 0, 21), week: ymd(monday(1)) },
    { id: 'e2', title: '', text: 'Dinner with Maya. Laughed a lot. Felt like myself again.', created: at(1, 3, 22), week: ymd(monday(1)) },
    { id: 'e3', title: 'Sunday', text: 'Did the breathing exercise before bed five nights this week.', created: at(1, 6, 19), week: ymd(monday(1)) },
  ] : w.ago === 3 ? [
    { id: 'e4', title: '', text: 'Turned off email after 7pm. Slept better.', created: at(3, 2, 21), week: ymd(monday(3)) },
  ] : [],
})).reverse()

const notes = { c1: { symptoms: 'Work-related stress and insomnia (since spring). No previous therapy.\nFollow up: sleep routine, boundaries at work.', updated: at(2, 1, 10) }, c2: { symptoms: '' } }

const details = {
  c1: { client: clients[0], weeks: [{ week: ymd(monday(0)), waiting: true, summary: null, shared: [] }, ...alexWeeks] },
  c2: { client: clients[1], weeks: [{ week: ymd(monday(0)), waiting: true, summary: null, shared: [{ id: 'e9', title: '', text: 'First time writing here. Not sure what to say yet, but it feels good to start.', created: at(0, 2, 22), week: ymd(monday(0)) }] }] },
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
  if (url.pathname.startsWith('/api/doctor/clients/')) {
    const [, , , , id, sub] = url.pathname.split('/')
    if (sub === 'notes') {
      notes[id] = { symptoms: body?.symptoms || '', updated: new Date().toISOString() }
      return { notes: clone(notes[id]) }
    }
    return clone({ ...details[id], notes: notes[id] })
  }
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
