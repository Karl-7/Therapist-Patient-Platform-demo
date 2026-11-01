// Doctor page: booking enquiries, clients (weekly AI summary + shared entries), affirmation library.
// Open doctor.html?demo=1 to preview the layout with sample data (no sign-in, nothing saved).
import { DEV, api, currentUser, isDoctor, loginUrl, signOut } from './auth.js'
import { showDevBanner } from './dev-backend.js'
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
          ` · ${b.service || 'Service not chosen'} · ${b.session || 'Format not chosen'} · Preferred date: ${b.date ? fmtDate(b.date + 'T00:00:00', { dateStyle: 'medium' }) : 'not given'}${b.guest ? ' · Sent without an account' : ''}`),
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

// One person's page: header (name, Summarize, Symptoms), changes, mood chart, week boxes, week page.
// Summaries are only made when the doctor presses "Summarize recent journals".
let detail = null // { client, weeks, notes }
let openWeek = null // week shown on its own page, or null for the overview

async function openClient(id, { keepView = false } = {}) {
  if (activeClient !== id) openWeek = null
  activeClient = id
  renderClientList()
  const box = $('clientDetail')
  if (!keepView) {
    openWeek = null
    box.innerHTML = '<p class="empty">Loading…</p>'
  }
  try {
    const data = await call(`/api/doctor/clients/${encodeURIComponent(id)}`)
    if (activeClient !== id) return
    detail = data
    renderDetail()
    if (!keepView && window.innerWidth < 800) box.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (err) {
    onError(err, box)
  }
  if (!keepView) checkSummaries(id)
}

const weekRange = (monday, withYear = true) => {
  const start = new Date(monday + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const o = { day: 'numeric', month: 'short' }
  return `${start.toLocaleDateString(undefined, o)} – ${end.toLocaleDateString(undefined, withYear ? { ...o, year: 'numeric' } : o)}`
}

function renderDetail() {
  const box = $('clientDetail')
  const { client, weeks, notes } = detail
  box.innerHTML = ''

  // Header: name, summarize, symptoms.
  const summarize = el('button', { className: 'btn small', type: 'button', id: 'summarizeBtn', textContent: 'Summarize recent journals' })
  summarize.onclick = () => startSummaries(client.id)
  const symptomsBtn = el('button', { className: 'btn secondary small', type: 'button', textContent: notes?.symptoms ? 'Symptoms •' : 'Symptoms' })
  symptomsBtn.setAttribute('aria-expanded', 'false')
  const symptoms = renderSymptoms(client.id, notes, symptomsBtn)
  symptomsBtn.onclick = () => {
    const open = symptoms.classList.toggle('hidden') === false
    symptomsBtn.setAttribute('aria-expanded', String(open))
    if (open) symptoms.querySelector('textarea').focus()
  }
  box.append(
    el('div', { className: 'client-head' },
      el('div', {},
        el('h3', { textContent: client.name || client.email }),
        el('div', { className: 'meta', textContent: `${client.email}${client.createdAt ? ' · joined ' + fmtDate(client.createdAt, { dateStyle: 'medium' }) : ''}` })),
      el('div', { className: 'client-actions' }, summarize, symptomsBtn)),
    symptoms,
    summaryBar)
  applySummaryState()

  if (openWeek) {
    const w = weeks.find((x) => x.week === openWeek)
    if (w) return box.append(renderWeekPage(w))
    openWeek = null
  }

  const summarized = weeks.filter((w) => w.summary)
  if (!weeks.length) return box.append(el('p', { className: 'empty', textContent: 'No journal entries yet.' }))

  // What changed: latest summarised week vs the three before it.
  const latest = summarized[0]
  const changes = latest?.summary?.changes || []
  box.append(el('section', { className: 'panel-box changes' },
    el('h4', { textContent: 'What changed recently' }),
    el('p', { className: 'meta', textContent: latest ? `Week of ${weekRange(latest.week)} compared with the three weeks before` : 'Not summarized yet' }),
    changes.length
      ? el('ul', {}, ...changes.map((c) => el('li', { textContent: c })))
      : el('p', { className: 'meta', textContent: latest ? 'Shown once at least two weeks are summarized.' : 'Press “Summarize recent journals” to create the first summaries.' })))

  // Mood over all summarised weeks.
  box.append(renderMoodChart(summarized.filter((w) => Number.isFinite(w.summary.mood)).map((w) => ({ week: w.week, mood: w.summary.mood })).reverse()))

  // One box per week, newest first. Tap to see that week's shared entries.
  const list = el('div', { className: 'week-list' })
  weeks.forEach((w) => {
    const s = w.summary
    const card = el('button', { type: 'button', className: 'week-card' },
      el('span', { className: 'week-date', textContent: `Week of ${weekRange(w.week)}` }),
      s ? el('span', { className: 'week-summary', textContent: s.summary }) : el('span', { className: 'week-summary muted', textContent: 'Not summarized yet.' }),
      s?.comparison ? el('span', { className: 'week-compare', textContent: 'Compared with the week before: ' + s.comparison }) : null,
      el('span', { className: 'week-foot', textContent: `${w.shared.length} shared ${w.shared.length === 1 ? 'entry' : 'entries'}${s && w.waiting ? ' · new writing since this summary' : ''} ›` }))
    card.onclick = () => {
      openWeek = w.week
      renderDetail()
      $('clientDetail').scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    list.append(card)
  })
  box.append(list)
}

// Doctor's own notes. Saved automatically, visible only to doctors.
function renderSymptoms(clientId, notes, button) {
  const area = el('textarea', { className: 'field', value: notes?.symptoms || '', placeholder: 'Presenting symptoms, background, things to follow up…', ariaLabel: 'Symptoms and notes' })
  const saved = el('span', { className: 'meta', textContent: notes?.updated ? 'Saved ' + fmtDate(notes.updated) : 'Only doctors can see this.' })
  let timer = null
  const save = async () => {
    clearTimeout(timer)
    saved.textContent = 'Saving…'
    try {
      const res = await call(`/api/doctor/clients/${encodeURIComponent(clientId)}/notes`, { method: 'PUT', body: { symptoms: area.value } })
      detail.notes = res.notes
      saved.textContent = 'Saved ' + fmtDate(res.notes.updated)
      button.textContent = area.value.trim() ? 'Symptoms •' : 'Symptoms'
    } catch (err) {
      saved.textContent = 'Not saved: ' + err.message
      onError(err)
    }
  }
  area.oninput = () => { saved.textContent = 'Editing…'; clearTimeout(timer); timer = setTimeout(save, 900) }
  area.onblur = () => timer && save()
  return el('div', { className: 'symptoms hidden' }, el('label', { className: 'symptoms-label', textContent: 'Symptoms' }), area, saved)
}

// Week page: summary, then every entry the person shared, Monday to Sunday.
function renderWeekPage(w) {
  const back = el('button', { type: 'button', className: 'linkish', textContent: '← All weeks' })
  back.onclick = () => { openWeek = null; renderDetail() }
  const s = w.summary
  const page = el('section', { className: 'week-page' },
    back,
    el('h4', { className: 'week-date big', textContent: `Week of ${weekRange(w.week)}` }),
    s
      ? el('div', { className: 'ai' },
          el('div', { className: 'label', textContent: `AI WEEKLY SUMMARY${Number.isFinite(s.mood) ? ` · MOOD ${s.mood}/10` : ''}` }),
          el('p', { textContent: s.summary }),
          s.comparison ? el('div', { className: 'compare' }, el('div', { className: 'label', textContent: 'COMPARED WITH THE WEEK BEFORE' }), el('p', { textContent: s.comparison })) : null)
      : el('div', { className: 'ai missing', textContent: 'This week is not summarized yet.' }),
    el('h4', { className: 'shared-title', textContent: 'Entries shared with you' }))

  if (!w.shared.length) {
    page.append(el('p', { className: 'meta', textContent: 'No entries were shared this week.' }))
    return page
  }
  const byDay = new Map()
  w.shared.forEach((e) => {
    const d = new Date(e.created)
    const key = d.toDateString()
    if (!byDay.has(key)) byDay.set(key, { date: d, items: [] })
    byDay.get(key).items.push(e)
  })
  ;[...byDay.values()].sort((a, b) => a.date - b.date).forEach(({ date, items }) => {
    page.append(el('div', { className: 'day' },
      el('div', { className: 'day-name', textContent: date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) }),
      ...items.map((e) => el('div', { className: 'day-entry', dir: 'auto' }, e.title ? el('div', { className: 'day-entry-title', textContent: e.title, dir: 'auto' }) : null, el('p', { textContent: e.text, dir: 'auto' })))))
  })
  return page
}

/* ---------- mood chart ---------- */
// Single series line, 1–10. Only the latest week's date is written on the x axis.
function renderMoodChart(points) {
  const wrap = el('section', { className: 'panel-box mood' },
    el('h4', { textContent: 'Mood by week' }),
    el('p', { className: 'meta', textContent: 'AI estimate from everything the person wrote that week · 1 = very low, 10 = very good' }))
  if (!points.length) {
    wrap.append(el('p', { className: 'meta', textContent: 'No summarized weeks yet.' }))
    return wrap
  }
  const plot = el('div', { className: 'mood-plot' })
  const tip = el('div', { className: 'mood-tip hidden', role: 'status' })
  plot.append(tip)
  // Same data as a table, for screen readers.
  const table = el('table', { className: 'sr-only' },
    el('caption', { textContent: 'Mood by week' }),
    el('tr', {}, el('th', { textContent: 'Week' }), el('th', { textContent: 'Mood (1–10)' })),
    ...points.map((p) => el('tr', {}, el('td', { textContent: weekRange(p.week) }), el('td', { textContent: String(p.mood) }))))
  wrap.append(plot, table)

  const NS = 'http://www.w3.org/2000/svg'
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag)
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v))
    return n
  }

  const draw = () => {
    const W = Math.max(260, plot.clientWidth || 600)
    const H = 190
    const pad = { l: 30, r: 16, t: 12, b: 28 }
    const x = (i) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1))
    const y = (v) => pad.t + ((10 - v) * (H - pad.t - pad.b)) / 9
    plot.querySelector('svg')?.remove()
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Mood by week, ${points.length} weeks, latest ${points[points.length - 1].mood} out of 10` })

    // Recessive grid and y labels.
    ;[1, 4, 7, 10].forEach((v) => {
      svg.append(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }))
      const t = svgEl('text', { x: pad.l - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' })
      t.textContent = v
      svg.append(t)
    })
    // Only the latest week's date on the x axis.
    const last = points[points.length - 1]
    const xl = svgEl('text', { x: x(points.length - 1), y: H - 8, class: 'axis', 'text-anchor': points.length === 1 ? 'middle' : 'end' })
    xl.textContent = new Date(last.week + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    svg.append(xl)

    if (points.length > 1) svg.append(svgEl('polyline', { points: points.map((p, i) => `${x(i)},${y(p.mood)}`).join(' '), class: 'line' }))
    const cross = svgEl('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' })
    svg.append(cross)
    const dots = points.map((p, i) => {
      const c = svgEl('circle', { cx: x(i), cy: y(p.mood), r: 4.5, class: 'dot' })
      svg.append(c)
      return c
    })

    // Hover / touch: nearest week gets a crosshair and a tooltip.
    const hit = svgEl('rect', { x: pad.l - 10, y: 0, width: W - pad.l - pad.r + 20, height: H, fill: 'transparent' })
    const show = (evt) => {
      const r = svg.getBoundingClientRect()
      const px = evt.clientX - r.left
      let i = 0
      points.forEach((_, k) => { if (Math.abs(x(k) - px) < Math.abs(x(i) - px)) i = k })
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible')
      dots.forEach((d, k) => d.setAttribute('r', k === i ? 6 : 4.5))
      tip.textContent = `Week of ${weekRange(points[i].week, false)} · mood ${points[i].mood}/10`
      tip.classList.remove('hidden')
      tip.style.left = Math.min(Math.max(x(i) - tip.offsetWidth / 2, 0), W - tip.offsetWidth) + 'px'
      tip.style.top = Math.max(y(points[i].mood) - 40, 0) + 'px'
    }
    const hide = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('r', 4.5)); tip.classList.add('hidden') }
    hit.addEventListener('pointermove', show)
    hit.addEventListener('pointerdown', show)
    hit.addEventListener('pointerleave', hide)
    svg.append(hit)
    plot.prepend(svg)
  }
  // Draw once it is on the page, and again when the width changes.
  setTimeout(draw, 0)
  if ('ResizeObserver' in window) {
    let lastW = 0
    new ResizeObserver(() => { if (plot.clientWidth && plot.clientWidth !== lastW) { lastW = plot.clientWidth; draw() } }).observe(plot)
  }
  return wrap
}

/* ---------- AI summary progress ---------- */
const summaryBar = el('div', { className: 'ai-status hidden', role: 'status', ariaLive: 'polite' })
let pollTimer = null
let lastPendingForClient = null
let summaryState = null

// Status only; never starts the server.
async function checkSummaries(clientId) {
  if (DEMO) return
  clearTimeout(pollTimer)
  lastPendingForClient = null
  try {
    showSummaryStatus(await call(`/api/doctor/summaries/status?clientId=${encodeURIComponent(clientId)}`), clientId)
  } catch (err) {
    onError(err)
  }
}

// "Summarize recent journals": starts the AI server if anything is waiting.
async function startSummaries(clientId) {
  if (DEMO) {
    summaryState = { state: 'demo' }
    return applySummaryState()
  }
  clearTimeout(pollTimer)
  const btn = $('summarizeBtn')
  if (btn) btn.disabled = true
  try {
    showSummaryStatus(await call('/api/doctor/summaries/refresh', { method: 'POST', body: { clientId } }), clientId, true)
  } catch (err) {
    if (btn) btn.disabled = false
    onError(err)
  }
}

function showSummaryStatus(s, clientId, pressed = false) {
  if (clientId !== activeClient) return
  summaryState = { ...s, pressed }
  applySummaryState()
  const forThem = s.pendingForClient || 0
  // When this person's weeks are done, reload their page.
  if (lastPendingForClient !== null && forThem < lastPendingForClient) openClient(clientId, { keepView: true })
  lastPendingForClient = forThem
  if (s.state === 'starting' || s.state === 'running') pollTimer = setTimeout(() => pollSummaries(clientId), DEV ? 1500 : 15000)
}

async function pollSummaries(clientId) {
  try {
    showSummaryStatus(await call(`/api/doctor/summaries/status?clientId=${encodeURIComponent(clientId)}`), clientId)
  } catch (err) {
    onError(err)
  }
}

function applySummaryState() {
  const s = summaryState
  const btn = $('summarizeBtn')
  if (!s) return summaryBar.classList.add('hidden')
  const forThem = s.pendingForClient || 0
  const weeks = (n) => `${n} week${n === 1 ? '' : 's'}`
  const busy = s.state === 'starting' || s.state === 'running'
  const text = {
    demo: 'Sample preview: summarizing is not available here.',
    'not-configured': 'The AI server is not connected yet, so summaries cannot be made.',
    idle: s.pressed ? 'Everything is already summarized.' : 'All weeks are summarized.',
    waiting: forThem
      ? `${weeks(forThem)} not summarized yet. Press “Summarize recent journals”.`
      : `This person is up to date. ${weeks(s.pending)} for other people not summarized yet.`,
    starting: 'Starting the AI server. This usually takes 2–4 minutes; the page updates by itself.',
    running: `Writing summaries… ${forThem ? `${weeks(forThem)} left for this person, ` : 'this person is done, '}${weeks(s.pending)} left in total.`,
    error: `The last run had a problem: ${s.lastError || 'unknown error'}`,
  }[s.state] || ''
  summaryBar.textContent = text
  summaryBar.className = `ai-status ${s.state}` + (text ? '' : ' hidden')
  if (btn) {
    btn.disabled = busy || s.state === 'not-configured' || s.state === 'demo'
    btn.textContent = busy ? 'Summarizing…' : 'Summarize recent journals'
  }
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
  if (!DEMO) showDevBanner()
  let tab = 'bookings'
  try { tab = sessionStorage.getItem('sst_doctor_tab') || tab } catch {}
  showTab(['bookings', 'clients', 'affirmations'].includes(tab) ? tab : 'bookings')
  if (tab !== 'bookings') loadBookings() // keeps the "new" count on the tab current
}
start()
