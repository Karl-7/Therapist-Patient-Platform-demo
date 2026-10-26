// Loaded at the end of every Private page (index, about, booking, affirmations, contact).
// 1. Requires sign-in.  2. Adds the account menu.  3. Moves journal, booking and
// affirmations from this browser onto the site's Netlify storage.
// The page's own script runs first, so this file replaces its handlers.
import { api, currentUser, forwardAuthLinks, isDoctor, loginUrl, signOut } from './auth.js'
import { showDevBanner } from './dev-backend.js'

const $ = (id) => document.getElementById(id)
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...kids)
  return node
}
const reveal = () => document.documentElement.classList.remove('auth-pending')

// Monday of the local week, YYYY-MM-DD.
function localWeek(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ---------- account menu ---------- */
function addAccountMenu(user) {
  const nav = $('navlinks')
  if (!nav) return
  const style = document.createElement('style')
  style.textContent = '.account{display:flex;align-items:center;gap:8px;padding-left:8px;border-left:1px solid var(--line,#e8dfed)}.account span{font-size:12px;color:#8a7fa0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(max-width:650px){.account{border-left:0;padding:8px 5px}}'
  document.head.append(style)
  const out = el('button', { className: 'btn secondary small', type: 'button', textContent: 'Sign out' })
  out.onclick = async () => { await signOut(); location.replace(loginUrl('private', 'signed-out')) }
  nav.append(el('div', { className: 'account' }, el('span', { textContent: user.name || user.email || 'Signed in', title: user.email || '' }), out))
}

/* ---------- journal ---------- */
let entries = []

function setupJournal() {
  if (!$('journalText') || !$('saveJournal')) return
  const status = (t) => ($('journalStatus').textContent = t)

  // "Share with my therapist" checkbox under the text box.
  const share = el('input', { type: 'checkbox', id: 'journalShare' })
  share.style.cssText = 'width:17px;height:17px;accent-color:#7866a8;flex:none'
  const shareLabel = el('label', { htmlFor: 'journalShare' }, share, el('span', { textContent: 'Share this entry with my therapist' }))
  shareLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin:-4px 0 12px;font-size:14px;cursor:pointer'
  $('journalText').after(shareLabel)

  const notice = document.querySelector('#journal .notice')
  if (notice) {
    notice.textContent = 'Entries are saved to your account, so you can read them on any device. Your therapist can read only the entries you share. Each week an AI-written summary of all your entries, shared or not, is prepared for your therapist.'
  }
  const sub = $('journalEntries')?.previousElementSibling
  if (sub?.classList.contains('sub')) sub.textContent = 'Your saved reflections, on every device you sign in to.'

  $('saveJournal').onclick = async () => {
    const text = $('journalText').value.trim()
    if (!text) return status('Write a little note before saving.')
    $('saveJournal').disabled = true
    status('Saving…')
    try {
      const { entry } = await api('/api/journals', { method: 'POST', body: { title: $('journalTitle').value.trim(), text, shared: share.checked, week: localWeek(), created: new Date().toISOString() } })
      entries.unshift(entry)
      $('journalTitle').value = ''
      $('journalText').value = ''
      share.checked = false
      status(entry.shared ? 'Saved and shared with your therapist.' : 'Saved to your account.')
      renderJournalList()
    } catch (err) {
      status(handleApiError(err, 'Could not save. Please try again.'))
    } finally {
      $('saveJournal').disabled = false
    }
  }

  // The page script calls renderJournals(); point it at the account copy.
  window.renderJournals = renderJournalList
  loadJournals()
}

async function loadJournals() {
  $('journalEntries').innerHTML = '<p class="empty">Loading your journal…</p>'
  try {
    entries = (await api('/api/journals')).entries
    renderJournalList()
  } catch (err) {
    $('journalEntries').innerHTML = ''
    $('journalEntries').append(el('p', { className: 'empty', textContent: handleApiError(err, 'Could not load your journal.') }))
  }
}

function renderJournalList() {
  const out = $('journalEntries')
  out.innerHTML = ''
  renderImportBanner(out)
  if (!entries.length) {
    out.append(el('p', { className: 'empty', textContent: 'Your saved journal entries will appear here.' }))
    return
  }
  entries.forEach((entry) => {
    const badge = el('span', { textContent: entry.shared ? ' · Shared with therapist' : ' · Private' })
    badge.style.cssText = `font-size:12px;font-weight:600;color:${entry.shared ? '#4e7a4c' : '#8a7fa0'}`
    const toggle = el('button', { className: 'btn secondary small', type: 'button', textContent: entry.shared ? 'Stop sharing' : 'Share with therapist' })
    toggle.onclick = async () => {
      toggle.disabled = true
      try {
        const { entry: updated } = await api(`/api/journals?id=${encodeURIComponent(entry.id)}`, { method: 'PATCH', body: { shared: !entry.shared } })
        Object.assign(entry, updated)
        renderJournalList()
      } catch (err) {
        toggle.disabled = false
        $('journalStatus').textContent = handleApiError(err, 'Could not update sharing.')
      }
    }
    const del = el('button', { className: 'btn secondary small', type: 'button', textContent: 'Delete' })
    del.onclick = async () => {
      if (!confirm('Delete this journal entry? This cannot be undone.')) return
      try {
        await api(`/api/journals?id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' })
        entries = entries.filter((x) => x.id !== entry.id)
        renderJournalList()
      } catch (err) {
        $('journalStatus').textContent = handleApiError(err, 'Could not delete.')
      }
    }
    const actions = el('div', {}, toggle, del)
    actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap'
    out.append(el('div', { className: 'result' },
      el('strong', { textContent: entry.title || 'My reflection' }),
      el('small', { textContent: ' · ' + new Date(entry.created).toLocaleString() }),
      badge,
      el('p', { textContent: entry.text }),
      actions))
  })
}

// Entries written before accounts existed live only in this browser. Offer to move them.
function renderImportBanner(out) {
  let local = []
  try { local = JSON.parse(localStorage.getItem('sst_journals')) || [] } catch {}
  if (!local.length) return
  const btn = el('button', { className: 'btn small', type: 'button', textContent: `Move ${local.length} to my account` })
  btn.onclick = async () => {
    btn.disabled = true
    btn.textContent = 'Moving…'
    try {
      for (const e of local) {
        const created = e.created || new Date().toISOString()
        const { entry } = await api('/api/journals', { method: 'POST', body: { title: e.title || '', text: e.text, shared: false, created, week: localWeek(new Date(created)) } })
        entries.push(entry)
      }
      localStorage.removeItem('sst_journals')
      entries.sort((a, b) => b.created.localeCompare(a.created))
      renderJournalList()
      $('journalStatus').textContent = 'Your earlier entries are now in your account (not shared).'
    } catch (err) {
      btn.disabled = false
      btn.textContent = 'Try again'
      $('journalStatus').textContent = handleApiError(err, 'Could not move entries.')
    }
  }
  const box = el('div', { className: 'result' }, el('p', { textContent: `You have ${local.length} journal ${local.length === 1 ? 'entry' : 'entries'} saved only in this browser from before.` }), btn)
  box.style.background = '#fcf9ff'
  out.append(box)
}

/* ---------- booking ---------- */
function setupBooking(user) {
  const form = $('bookingForm')
  if (!form) return
  if ($('bookName') && !$('bookName').value) $('bookName').value = user.name || ''
  if ($('bookEmail') && !$('bookEmail').value) $('bookEmail').value = user.email || ''
  const notice = form.querySelector('.notice')
  if (notice) notice.textContent = 'Your enquiry goes straight to the therapist, who will reply by email. Sending it does not confirm an appointment.'
  const submitBtn = form.querySelector('[type="submit"]')
  if (submitBtn) submitBtn.textContent = 'Send booking enquiry'

  // Runs before the page's old email-app handler and stops it.
  document.addEventListener('submit', async (e) => {
    if (e.target !== form) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const data = Object.fromEntries(new FormData(form))
    const status = (t) => ($('bookingStatus').textContent = t)
    submitBtn && (submitBtn.disabled = true)
    status('Sending…')
    try {
      await api('/api/bookings', { method: 'POST', body: data })
      form.reset()
      $('bookName').value = user.name || ''
      $('bookEmail').value = user.email || ''
      status('Thank you. Your enquiry has been sent. The therapist will reply by email. This is not yet an appointment confirmation.')
    } catch (err) {
      status(handleApiError(err, 'Could not send. Please try again, or email support@safe-spacetherapy.com.'))
    } finally {
      submitBtn && (submitBtn.disabled = false)
    }
  }, true)
}

/* ---------- affirmations ---------- */
async function loadAffirmations() {
  // `library`, renderCategories and renderSearch come from the page's own script.
  if (typeof library === 'undefined' || !Array.isArray(library)) return
  try {
    const { items } = await api('/api/affirmations')
    if (!Array.isArray(items) || !items.length) return
    library.splice(0, library.length, ...items)
    if (typeof renderCategories === 'function') renderCategories()
    if (typeof renderSearch === 'function') renderSearch($('searchInput')?.value || '')
  } catch {
    // Keep the starter list built into the page.
  }
}

function handleApiError(err, fallback) {
  if (err?.status === 401) {
    location.replace(loginUrl('private', 'expired'))
    return 'Your session has ended. Taking you to sign in…'
  }
  return err?.message || fallback
}

/* ---------- start ---------- */
async function start() {
  if (forwardAuthLinks()) return
  let user = null
  try {
    user = await currentUser()
  } catch {
    user = null
  }
  if (!user) return location.replace(loginUrl('private'))
  if (isDoctor(user)) return location.replace('doctor.html')
  addAccountMenu(user)
  showDevBanner()
  setupJournal()
  setupBooking(user)
  reveal()
  loadAffirmations()
}
start()
