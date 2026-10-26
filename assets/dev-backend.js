// Debug mode: used when the site is opened locally (file://, localhost) or from GitHub Pages,
// where the Netlify sign-in and Functions do not exist.
// Everything is stored in this browser's localStorage. Real user data is never touched.
// It mirrors netlify/functions/*, so pages behave the same as on Netlify.
import { DEFAULT_AFFIRMATIONS } from '../netlify/lib/default-affirmations.mjs'

// Turn debug mode off on localhost (e.g. with `netlify dev`) by opening any page with ?live=1; ?live=0 turns it back on.
function readLiveFlag() {
  try {
    const p = new URLSearchParams(location.search).get('live')
    if (p === '1') sessionStorage.setItem('sst_live', '1')
    if (p === '0') sessionStorage.removeItem('sst_live')
    return sessionStorage.getItem('sst_live') === '1'
  } catch {
    return false
  }
}

export const DEV = (() => {
  try {
    if (location.protocol === 'file:') return true
    const h = location.hostname
    const local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost') || h.endsWith('.github.io')
    return local && !readLiveFlag()
  } catch {
    return false
  }
})()

// One debug account that can sign in as either role.
export const DEBUG_EMAIL = 'debug@safespace.test'
export const DEBUG_PASSWORD = 'debug1234'
const DEBUG_PRIVATE = { id: 'debug-private', email: DEBUG_EMAIL, name: 'Debug Private', createdAt: '2026-01-01T00:00:00.000Z' }
const DEBUG_DOCTOR = { id: 'debug-doctor', email: DEBUG_EMAIL, name: 'Debug Doctor' }

const DB_KEY = 'sst_dev_db'
const SESSION_KEY = 'sst_dev_session'

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}
const loadDb = () => ({ accounts: [], journals: [], bookings: [], affirmations: null, summaries: [], ...read(DB_KEY, {}) })
const saveDb = (db) => write(DB_KEY, db)
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const fail = (status, message) => Object.assign(new Error(message), { status })
const clone = (x) => JSON.parse(JSON.stringify(x))

export function resetDevData() {
  try {
    localStorage.removeItem(DB_KEY)
    localStorage.removeItem(SESSION_KEY)
  } catch {}
}

/* ---------- accounts ---------- */
export function devCurrentUser() {
  return read(SESSION_KEY, null)
}

export function devSignIn(email, password, role) {
  email = email.trim().toLowerCase()
  if (email === DEBUG_EMAIL && password === DEBUG_PASSWORD) {
    const base = role === 'doctor' ? DEBUG_DOCTOR : DEBUG_PRIVATE
    const user = { ...base, roles: role === 'doctor' ? ['doctor'] : [], confirmedAt: base.createdAt }
    write(SESSION_KEY, user)
    return user
  }
  const acc = loadDb().accounts.find((a) => a.email === email)
  if (!acc || acc.password !== password) throw fail(401, 'Email or password is incorrect.')
  const user = { id: acc.id, email: acc.email, name: acc.name, roles: [], createdAt: acc.createdAt, confirmedAt: acc.createdAt }
  write(SESSION_KEY, user)
  return user
}

// Extra Private test accounts (handy for seeing several people on the Doctor page).
export function devSignUp(email, password, name) {
  email = email.trim().toLowerCase()
  const db = loadDb()
  if (email === DEBUG_EMAIL || db.accounts.some((a) => a.email === email)) throw fail(400, 'An account with this email already exists. Try signing in.')
  const acc = { id: 'dev-' + newId(), email, password, name: name || '', createdAt: new Date().toISOString() }
  db.accounts.push(acc)
  saveDb(db)
  const user = { id: acc.id, email, name: acc.name, roles: [], createdAt: acc.createdAt, confirmedAt: acc.createdAt }
  write(SESSION_KEY, user)
  return user
}

export function devSignOut() {
  try { localStorage.removeItem(SESSION_KEY) } catch {}
}

/* ---------- API ---------- */
const isDoctor = (u) => u?.roles?.includes('doctor')
const weekOf = (iso) => {
  const d = new Date(iso)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function devApi(path, { method = 'GET', body } = {}) {
  const url = new URL(path, 'http://dev.local')
  const route = url.pathname
  const id = url.searchParams.get('id')
  const user = devCurrentUser()
  const db = loadDb()

  if (route === '/api/affirmations') {
    if (method === 'GET') return { items: clone(db.affirmations?.items ?? DEFAULT_AFFIRMATIONS), updated: db.affirmations?.updated ?? null, isDefault: !db.affirmations }
    if (!user) throw fail(401, 'Please sign in.')
    if (!isDoctor(user)) throw fail(403, 'Doctor access only.')
    const items = (body?.items || []).filter((x) => x?.text?.trim()).map((x, i) => ({
      id: x.id || 'a' + Date.now().toString(36) + i,
      category: (x.category || 'General').trim(),
      tags: (x.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
      text: x.text.trim(),
    }))
    db.affirmations = { items, updated: new Date().toISOString(), updatedBy: user.email }
    saveDb(db)
    return clone(db.affirmations)
  }

  if (!user) throw fail(401, 'Please sign in.')

  if (route === '/api/journals') {
    if (isDoctor(user)) throw fail(403, 'Doctor accounts do not keep a journal.')
    const mine = db.journals.filter((e) => e.userId === user.id)
    if (method === 'GET') return { entries: clone(mine).sort((a, b) => b.created.localeCompare(a.created)) }
    if (method === 'POST') {
      if (!body?.text?.trim()) throw fail(400, 'Write a little note before saving.')
      const created = body.created || new Date().toISOString()
      const entry = { id: newId(), userId: user.id, title: (body.title || '').trim(), text: body.text.trim(), shared: body.shared === true, created, week: body.week || weekOf(created) }
      db.journals.push(entry)
      saveDb(db)
      return { entry: clone(entry) }
    }
    const entry = mine.find((e) => e.id === id)
    if (!entry) throw fail(404, 'Entry not found')
    if (method === 'PATCH') {
      if (typeof body?.shared === 'boolean') entry.shared = body.shared
      if (typeof body?.title === 'string') entry.title = body.title.trim()
      if (body?.text?.trim()) entry.text = body.text.trim()
      entry.updated = new Date().toISOString()
      saveDb(db)
      return { entry: clone(entry) }
    }
    if (method === 'DELETE') {
      db.journals = db.journals.filter((e) => e !== entry)
      saveDb(db)
      return { ok: true }
    }
  }

  if (route === '/api/bookings') {
    if (method === 'POST') {
      if (!body?.name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body?.email || '')) throw fail(400, 'Please add your name and a valid email.')
      const booking = { id: newId(), userId: user.id, accountEmail: user.email, name: body.name.trim(), email: body.email.trim(), session: body.session || '', date: body.date || '', message: (body.message || '').trim(), status: 'new', note: '', created: new Date().toISOString() }
      db.bookings.push(booking)
      saveDb(db)
      return { booking: { id: booking.id, created: booking.created } }
    }
    if (!isDoctor(user)) throw fail(403, 'Doctor access only.')
    if (method === 'GET') return { bookings: clone(db.bookings).sort((a, b) => b.created.localeCompare(a.created)) }
    if (method === 'PATCH') {
      const b = db.bookings.find((x) => x.id === id)
      if (!b) throw fail(404, 'Booking not found')
      if (['new', 'contacted', 'scheduled', 'closed'].includes(body?.status)) b.status = body.status
      if (typeof body?.note === 'string') b.note = body.note
      b.updated = new Date().toISOString()
      saveDb(db)
      return { booking: clone(b) }
    }
  }

  if (route.startsWith('/api/doctor/clients')) {
    if (!isDoctor(user)) throw fail(403, 'Doctor access only.')
    const people = [DEBUG_PRIVATE, ...db.accounts.map(({ id: pid, email, name, createdAt }) => ({ id: pid, email, name, createdAt }))]
    const clientId = decodeURIComponent(route.split('/')[4] || '')
    if (!clientId) return { clients: clone(people) }
    const client = people.find((p) => p.id === clientId)
    if (!client) throw fail(404, 'Not found')
    const weeks = new Map()
    const slot = (w) => weeks.get(w) || weeks.set(w, { week: w, summary: null, shared: [] }).get(w)
    db.summaries.filter((s) => s.userId === clientId).forEach((s) => (slot(s.week).summary = s))
    db.journals.filter((e) => e.userId === clientId && e.shared).forEach(({ id: eid, title, text, created, week }) => slot(week).shared.push({ id: eid, title, text, created, week }))
    const list = [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week))
    list.forEach((w) => w.shared.sort((a, b) => a.created.localeCompare(b.created)))
    return clone({ client, weeks: list })
  }

  throw fail(405, 'Method not allowed')
}

// Lets you see how a weekly summary looks in debug mode. The real ones come from your AI service.
export function devAddSampleSummary(userId) {
  const db = loadDb()
  const week = weekOf(new Date().toISOString())
  const count = db.journals.filter((e) => e.userId === userId && e.week === week).length
  db.summaries = db.summaries.filter((s) => !(s.userId === userId && s.week === week))
  db.summaries.push({
    userId,
    week,
    entryCount: count,
    summary: `(Sample text, written by debug mode, not by AI.) ${count} ${count === 1 ? 'entry' : 'entries'} this week.`,
    comparison: 'Your AI service will compare this week with the previous one here.',
    generatedAt: new Date().toISOString(),
  })
  saveDb(db)
}

/* ---------- banner ---------- */
export function showDevBanner() {
  if (!DEV || document.getElementById('sstDevBanner')) return
  const bar = document.createElement('div')
  bar.id = 'sstDevBanner'
  bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;max-width:calc(100% - 24px);background:#35405f;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 12px;border-radius:12px;box-shadow:0 6px 20px #0003;display:flex;gap:10px;align-items:center;flex-wrap:wrap'
  bar.textContent = 'Debug mode: data stays in this browser only.'
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.textContent = 'Reset debug data'
  reset.style.cssText = 'border:1px solid #ffffff66;background:transparent;color:#fff;border-radius:999px;padding:3px 10px;font:inherit;cursor:pointer'
  reset.onclick = () => {
    if (!confirm('Delete all debug accounts, journals, bookings and settings in this browser?')) return
    resetDevData()
    location.href = 'login.html'
  }
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '✕'
  close.setAttribute('aria-label', 'Hide debug banner')
  close.style.cssText = 'border:0;background:transparent;color:#fff;font:inherit;cursor:pointer;padding:0 2px'
  close.onclick = () => bar.remove()
  bar.append(reset, close)
  document.body.append(bar)
}
