// Affirmations on the Private pages: "Save" on every search result and on the featured card,
// and "Your Favorites" with "Remove". Saved affirmations live in the person's account.
// The page's own script provides `library`, `activeCategory`, renderCategories and the search box.
import { api } from './auth.js'

const $ = (id) => document.getElementById(id)
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...kids.filter((k) => k !== null && k !== undefined))
  return node
}

let favorites = []
let featured = null
let favFilter = 'All'
let onError = (err) => console.error(err)

const isSaved = (item) => favorites.some((f) => f.id === item.id)
const lib = () => (typeof library !== 'undefined' && Array.isArray(library) ? library : [])

export async function setupAffirmations(handleError) {
  onError = handleError || onError
  const hasUi = $('searchResults') || $('favoriteList') || $('featuredQuote')
  if (!hasUi) return
  // Replace the page's versions (which had a "Use this" button that did nothing visible).
  window.renderSearch = renderSearch
  window.renderFavorites = renderFavorites
  await loadFavorites()
  setupFeatured()
  renderSearch($('searchInput')?.value || '')
  renderFavorites()
}

// Called again after the library is loaded from the site.
export function refreshAffirmations() {
  if (featured && !lib().some((x) => x.id === featured.id)) pickFeatured()
  renderSearch($('searchInput')?.value || '')
  updateSaveButtons()
}

async function loadFavorites() {
  try {
    favorites = (await api('/api/favorites')).items || []
    // Favourites saved in this browser before accounts existed: move them into the account once.
    let local = []
    try { local = JSON.parse(localStorage.getItem('sst_favorites')) || [] } catch {}
    for (const f of local.filter((x) => x?.id && x?.text && !favorites.some((y) => y.id === x.id))) {
      favorites = (await api('/api/favorites', { method: 'POST', body: { id: f.id, text: f.text, category: f.category || '' } })).items
    }
    if (local.length) try { localStorage.removeItem('sst_favorites') } catch {}
  } catch (err) {
    onError(err)
  }
}

async function toggleSave(item, button) {
  if (button) button.disabled = true
  try {
    const res = isSaved(item)
      ? await api(`/api/favorites?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      : await api('/api/favorites', { method: 'POST', body: { id: item.id, text: item.text, category: item.category || '' } })
    favorites = res.items || []
  } catch (err) {
    onError(err)
  } finally {
    if (button) button.disabled = false
  }
  updateSaveButtons()
  renderFavorites()
}

function saveButton(item) {
  const b = el('button', { type: 'button', className: 'btn secondary small save-aff' })
  b.dataset.id = item.id
  b.onclick = () => toggleSave(item, b)
  paintSave(b, item)
  return b
}

function paintSave(b, item) {
  const saved = isSaved(item)
  b.textContent = saved ? '✓ Saved' : '♡ Save'
  b.setAttribute('aria-pressed', String(saved))
  b.title = saved ? 'Saved to Your Favorites. Tap to remove.' : 'Save to Your Favorites'
}

function updateSaveButtons() {
  document.querySelectorAll('.save-aff').forEach((b) => {
    const item = b.dataset.featured ? featured : lib().find((x) => x.id === b.dataset.id) || favorites.find((x) => x.id === b.dataset.id)
    if (item) paintSave(b, item)
  })
}

/* Search results and topics: each result gets a Save button. */
function renderSearch(query = '') {
  const out = $('searchResults')
  if (!out) return
  const q = query.trim().toLowerCase()
  const cat = typeof activeCategory !== 'undefined' ? activeCategory : 'All'
  out.innerHTML = ''
  if (!q && cat === 'All') {
    out.append(el('p', { className: 'notice', textContent: `Search above or choose a topic to explore ${lib().length} affirmations.` }))
    return
  }
  const items = lib().filter((x) => (cat === 'All' || x.category === cat) && (!q || `${x.text} ${x.category} ${(x.tags || []).join(' ')}`.toLowerCase().includes(q)))
  if (!items.length) {
    out.append(el('p', { className: 'empty', textContent: 'No match yet. Try another word or topic.' }))
    return
  }
  items.forEach((item) => out.append(el('div', { className: 'result' }, el('small', { textContent: item.category }), el('p', { textContent: `“${item.text}”` }), saveButton(item))))
}

/* Featured card ("A little more encouragement"): shows a random affirmation, with Save. */
function setupFeatured() {
  const quote = $('featuredQuote')
  const next = $('newQuote')
  if (!quote || !next) return
  const save = el('button', { type: 'button', className: 'btn small save-aff' })
  save.dataset.featured = '1'
  save.onclick = () => featured && toggleSave(featured, save)
  next.after(save)
  next.onclick = pickFeatured
  pickFeatured()
}

function pickFeatured() {
  const items = lib().filter((x) => x.id !== featured?.id)
  if (!items.length || !$('featuredQuote')) return
  featured = items[Math.floor(Math.random() * items.length)]
  $('featuredQuote').textContent = featured.text
  const save = document.querySelector('.save-aff[data-featured]')
  if (save) paintSave(save, featured)
}

/* Your Favorites: filter by topic, Remove. */
function renderFavorites() {
  const list = $('favoriteList')
  const filters = $('favoriteFilters')
  if (!list) return
  const cats = ['All', ...new Set(favorites.map((x) => x.category).filter(Boolean))]
  if (!cats.includes(favFilter)) favFilter = 'All'
  if (filters) {
    filters.innerHTML = ''
    if (favorites.length) {
      cats.forEach((c) => {
        const b = el('button', { type: 'button', className: 'chip' + (favFilter === c ? ' active' : ''), textContent: c })
        b.onclick = () => { favFilter = c; renderFavorites() }
        filters.append(b)
      })
    }
  }
  list.innerHTML = ''
  const shown = favorites.filter((x) => favFilter === 'All' || x.category === favFilter)
  if (!shown.length) {
    list.append(el('p', { className: 'empty', textContent: 'No saved affirmations yet. Tap “♡ Save” on one you love and it will appear here.' }))
    return
  }
  shown.forEach((item) => {
    const remove = el('button', { type: 'button', className: 'btn secondary small', textContent: 'Remove' })
    remove.onclick = () => toggleSave(item, remove)
    list.append(el('article', { className: 'saved-item' }, el('small', { textContent: item.category || 'Saved' }), el('p', { textContent: `“${item.text}”` }), remove))
  })
}
