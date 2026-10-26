// Doctor page: booking enquiries, clients (weekly AI summary + shared entries), affirmation library.
// Open doctor.html?demo=1 to preview the layout with sample data (no sign-in, nothing saved).
import { api, currentUser, isDoctor, loginUrl, signOut } from './auth.js'
import { demoApi } from './doctor-demo.js'

const $ = (id) => document.getElementById(id)
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...kids.filter((k) => k !== null && k !== undefined && k !== false))
  return node
}
const DEMO = new URLSearchParams(location.search).has('demo')
const call = DEMO ? demoApi : api

const fmtDate = (iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) => (iso ? new Date(iso).toLocaleString(undefined, opts) : '')
function weekLabel(monday) {
  const start = new Date(monday + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const o = { month: 'short', day: 'numeric' }
  return `Week of ${start.toLocaleDateString(undefined, o)} – ${end.toLocaleDateString(undefined, { ...o, year: 'numeric' })}`
}
function onError(err, target) {
  if (err?.status === 401) return location.replace(loginUrl('doctor', 'expired'))
  if (err?.status === 403) return location.replace(loginUrl('doctor', 'not-doctor'))
  if (target) {
    target.innerHTML = ''
    target.append(el('p', { className: 'empty', textContent: err?.message || 'Something went wrong.' }))
  }
}

/* ---------- tabs ---------- */
const loaded = {}
function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)))
  ;['bookings', 'clients', 'affirmations'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== name))
  if (!loaded[name]) {
    loaded[name] = true
    ;({ bookings: loadBookings, clients: loadClients, affirmations: loadAffirmations })[name]()
  }
  try { sessionStorage.setItem('sst_doctor_tab', name) } catch {}
}
document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)))

/* ---------- bookings ---------- */
const STATUSES = ['new', 'contacted', 'scheduled', 'closed']
let bookings = []
let statusFilter = 'open'

async function loadBookings() {
  try {
    bookings = (await call('/api/bookings')).bookings
    renderBookings()
  } catch (err) {
    onError(err, $('bookingList'))
  }
}

function renderBookings() {
  const newCount = bookings.filter((b) => b.status === 'new').length
  $('newCount').textContent = newCount
  $('newCount').classList.toggle('hidden', !newCount)

  const filters = [['open', 'Open'], ['all', 'All'], ...STATUSES.map((s) => [s, s[0].toUpperCase() + s.slice(1)])]
  $('statusFilter').innerHTML = ''
  filters.forEach(([key, label]) => {
    const b = el('button', { className: 'chip' + (statusFilter === key ? ' active' : ''), type: 'button', textContent: label })
    b.onclick = () => { statusFilter = key; renderBookings() }
    $('statusFilter').append(b)
  })

  const shown = bookings.filter((b) => statusFilter === 'all' || (statusFilter === 'open' ? b.status !== 'closed' : b.status === statusFilter))
  const list = $('bookingList')
  list.innerHTML = ''
  if (!shown.length) return list.append(el('p', { className: 'empty', textContent: bookings.length ? 'Nothing in this view.' : 'No enquiries yet.' }))

  shown.forEach((b) => {
    const status = el('select', { className: 'field', ariaLabel: 'Status' }, ...STATUSES.map((s) => el('option', { value: s, textContent: s[0].toUpperCase() + s.slice(1), selected: s === b.status })))
    const note = el('textarea', { className: 'field', placeholder: 'Private note (only doctors see this)', value: b.note || '', ariaLabel: 'Note' })
    const saved = el('span', { className: 'notice' })
    const save = async (patch) => {
      saved.textContent = 'Saving…'
      try {
        Object.assign(b, (await call(`/api/bookings?id=${encodeURIComponent(b.id)}`, { method: 'PATCH', body: patch })).booking)
        saved.textContent = 'Saved'
        if (patch.status) renderBookings()
      } catch (err) {
        saved.textContent = err.message
        onError(err)
      }
    }
    status.onchange = () => save({ status: status.value })
    note.onchange = () => save({ note: note.value })

    const replyHref = `mailto:${encodeURIComponent(b.email)}?subject=${encodeURIComponent('Your Safe Space Therapy enquiry')}`
    list.append(el('article', { className: 'booking' },
      el('div', {},
        el('h3', {}, b.name, el('span', { className: 'pill ' + b.status, textContent: b.status })),
        el('div', { className: 'meta' },
          el('a', { href: replyHref, textContent: b.email }),
          ` · ${b.session || 'Session not chosen'} · Preferred date: ${b.date ? fmtDate(b.date + 'T00:00:00', { dateStyle: 'medium' }) : 'not given'}`),
        el('div', { className: 'meta', textContent: 'Sent ' + fmtDate(b.created) }),
        b.message ? el('p', { textContent: b.message }) : el('p', { className: 'meta', textContent: 'No message.' })),
      el('div', {}, el('label', { className: 'meta', textContent: 'Status' }), status, note, saved)))
  })
}

/* ---------- clients ---------- */
let clients = []
let activeClient = null

async function loadClients() {
  try {
    clients = (await call('/api/doctor/clients')).clients
    renderClientList()
  } catch (err) {
    onError(err, $('clientList'))
  }
}
$('clientSearch').oninput = () => renderClientList()

function renderClientList() {
  const q = $('clientSearch').value.trim().toLowerCase()
  const list = $('clientList')
  list.innerHTML = ''
  const shown = clients.filter((c) => !q || `${c.name} ${c.email}`.toLowerCase().includes(q))
  if (!shown.length) return list.append(el('p', { className: 'empty', textContent: clients.length ? 'No match.' : 'No Private accounts yet.' }))
  shown.forEach((c) => {
    const b = el('button', { type: 'button' }, c.name || c.email, el('small', { textContent: c.name ? c.email : 'Joined ' + fmtDate(c.createdAt, { dateStyle: 'medium' }) }))
    b.setAttribute('aria-current', String(c.id === activeClient))
    b.onclick = () => openClient(c.id)
    list.append(b)
  })
}

async function openClient(id) {
  activeClient = id
  renderClientList()
  const box = $('clientDetail')
  box.innerHTML = '<p class="empty">Loading…</p>'
  try {
    const { client, weeks } = await call(`/api/doctor/clients/${encodeURIComponent(id)}`)
    if (activeClient !== id) return
    box.innerHTML = ''
    box.append(
      el('h3', { textContent: client.name || client.email, style: 'margin:0;font-size:20px' }),
      el('div', { className: 'meta', textContent: `${client.email}${client.createdAt ? ' · joined ' + fmtDate(client.createdAt, { dateStyle: 'medium' }) : ''}` }))
    if (!weeks.length) {
      box.append(el('p', { className: 'empty', textContent: 'No weekly summaries or shared entries yet.' }))
      return
    }
    weeks.forEach((w) => box.append(renderWeek(w)))
    if (window.innerWidth < 800) box.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (err) {
    onError(err, box)
  }
}

function renderWeek(w) {
  const s = w.summary
  const ai = s
    ? el('div', { className: 'ai' },
        el('div', { className: 'label', textContent: 'AI WEEKLY SUMMARY' + (s.entryCount ? ` · ${s.entryCount} ${s.entryCount === 1 ? 'entry' : 'entries'}` : '') }),
        el('p', { textContent: s.summary || '' }),
        s.comparison ? el('div', { className: 'compare' }, el('div', { className: 'label', textContent: 'COMPARED WITH THE PREVIOUS WEEK' }), el('p', { textContent: s.comparison })) : null,
        s.generatedAt ? el('div', { className: 'notice', textContent: 'Generated ' + fmtDate(s.generatedAt) }) : null)
    : el('div', { className: 'ai missing', textContent: 'The AI summary for this week has not been generated yet.' })

  const shared = w.shared.length
    ? w.shared.map((e) => el('div', { className: 'entry' },
        el('strong', { textContent: e.title || 'Reflection' }),
        el('span', { className: 'meta', textContent: ' · ' + fmtDate(e.created, { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }),
        el('p', { textContent: e.text })))
    : [el('p', { className: 'meta', textContent: 'No entries shared this week.', style: 'margin:12px 0 0' })]

  return el('section', { className: 'week' },
    el('h3', { textContent: weekLabel(w.week) }),
    ai,
    el('div', { className: 'label meta', textContent: `Shared entries (${w.shared.length})`, style: 'margin-top:14px;font-weight:700' }),
    ...shared)
}

/* ---------- affirmations ---------- */
let affirmations = []
let dirty = false

async function loadAffirmations() {
  try {
    const data = await call('/api/affirmations')
    affirmations = data.items.map((x) => ({ ...x, tags: [...(x.tags || [])] }))
    renderAffirmations()
    setAffStatus(data.isDefault ? 'Showing the starter list. Save to make it yours.' : 'Last saved ' + fmtDate(data.updated))
  } catch (err) {
    onError(err, $('affList'))
  }
}

function setAffStatus(text, kind = '') {
  $('affStatus').textContent = text
  $('affStatus').className = 'status' + (kind ? ' ' + kind : '')
}
function markDirty() {
  dirty = true
  setAffStatus('Unsaved changes')
}
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault() })

function renderAffirmations() {
  $('categoryOptions').innerHTML = ''
  ;[...new Set(affirmations.map((a) => a.category).filter(Boolean))].forEach((c) => $('categoryOptions').append(el('option', { value: c })))

  const q = $('affSearch').value.trim().toLowerCase()
  const list = $('affList')
  list.innerHTML = ''
  const shown = affirmations.filter((a) => !q || `${a.category} ${a.text} ${a.tags.join(' ')}`.toLowerCase().includes(q))
  if (!shown.length) return list.append(el('p', { className: 'empty', textContent: 'No affirmations here.' }))
  shown.forEach((a) => {
    const cat = el('input', { className: 'field', value: a.category, placeholder: 'Category', ariaLabel: 'Category' })
    cat.setAttribute('list', 'categoryOptions')
    cat.oninput = () => { a.category = cat.value; markDirty() }
    const text = el('textarea', { className: 'field aff-text', value: a.text, placeholder: 'Write the affirmation…', ariaLabel: 'Affirmation text', rows: 2 })
    text.oninput = () => { a.text = text.value; markDirty() }
    const tags = el('input', { className: 'field aff-tags', value: a.tags.join(', '), placeholder: 'calm, breathing', ariaLabel: 'Tags' })
    tags.oninput = () => { a.tags = tags.value.split(',').map((t) => t.trim()).filter(Boolean); markDirty() }
    const del = el('button', { className: 'icon-btn', type: 'button', textContent: '✕', title: 'Remove', ariaLabel: 'Remove affirmation' })
    del.onclick = () => {
      if (a.text && !confirm('Remove this affirmation?')) return
      affirmations = affirmations.filter((x) => x !== a)
      markDirty()
      renderAffirmations()
    }
    list.append(el('div', { className: 'aff-row' }, cat, text, tags, del))
  })
}
$('affSearch').oninput = () => renderAffirmations()
$('affAdd').onclick = () => {
  affirmations.unshift({ id: 'a' + Date.now().toString(36), category: '', text: '', tags: [] })
  $('affSearch').value = ''
  markDirty()
  renderAffirmations()
  $('affList').querySelector('textarea')?.focus()
}
$('affSave').onclick = async () => {
  const items = affirmations.filter((a) => a.text.trim())
  $('affSave').disabled = true
  setAffStatus('Saving…')
  try {
    const saved = await call('/api/affirmations', { method: 'PUT', body: { items } })
    affirmations = saved.items.map((x) => ({ ...x, tags: [...x.tags] }))
    dirty = false
    renderAffirmations()
    setAffStatus(`Saved ${saved.items.length} affirmations. They are live on the site now.`, 'ok')
  } catch (err) {
    setAffStatus(err.message, 'error')
    onError(err)
  } finally {
    $('affSave').disabled = false
  }
}

/* ---------- start ---------- */
$('signOutBtn').onclick = async () => {
  if (DEMO) return location.replace('login.html?as=doctor')
  await signOut()
  location.replace(loginUrl('doctor', 'signed-out'))
}

async function start() {
  let user
  if (DEMO) {
    user = { name: 'Dr. Sample', email: 'doctor@example.com', roles: ['doctor'] }
    $('demoBanner').classList.remove('hidden')
  } else {
    user = await currentUser().catch(() => null)
    if (!user) return location.replace(loginUrl('doctor'))
    if (!isDoctor(user)) return location.replace(loginUrl('doctor', 'not-doctor'))
  }
  $('who').textContent = user.name || user.email
  document.documentElement.classList.remove('auth-pending')
  let tab = 'bookings'
  try { tab = sessionStorage.getItem('sst_doctor_tab') || tab } catch {}
  showTab(['bookings', 'clients', 'affirmations'].includes(tab) ? tab : 'bookings')
  if (tab !== 'bookings') loadBookings() // keeps the "new" count on the tab current
}
start()
