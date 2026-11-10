// "How are you feeling today?" mood picker. The same picker appears on the home page and in the
// journal. Every tap rises up with a small animation and is counted for today; the counts become a
// hidden first line in today's journal ("I feel very happy and a bit sad today.") that only the
// weekly AI summary reads. It helps note how someone feels even on days they do not want to write.
import { api } from './auth.js'
import { MOODS } from '../netlify/lib/moods.mjs'

const QUOTES = {
  Happy: 'Let yourself enjoy this moment. You deserve the little joys, too. 💛',
  Sad: 'It is okay to feel sad. You do not have to pretend to be okay to deserve care. 💗',
  Anxious: 'Come back to one slow breath. You only need to take the next small step. 🌿',
  Stressed: 'Pause for a moment. You are allowed to rest, even when there is more to do. ☁️',
  Overwhelmed: 'You do not have to do everything at once. One small thing is enough for now. 💗',
  Lonely: 'Even when you feel alone, you still matter and you are worthy of connection. 🫶',
  Okay: 'You do not need to feel amazing every day. Being here is enough. 🌼',
  Good: 'Let this good feeling have a little space. You are allowed to enjoy it. ✨',
  Great: 'Celebrate this moment and the light you are carrying today. ☀️',
}
const TITLE = 'How are you feeling today?'
const SUB = 'Choose the mood that feels closest to you right now.'
const NOTICE = 'Tap as often as you like, even on days you do not feel like writing.'
// Moods shown at once: 5 on wider screens, 2 on phones (matches the page's phone layout).
const narrow = window.matchMedia('(max-width: 650px)')
const visibleCount = () => (narrow.matches ? 2 : 5)

const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...kids.filter((k) => k !== null && k !== undefined))
  return node
}
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

let onError = (err) => console.error(err)

let guest = false // not signed in: check-ins are shown but not saved

export function setupMoodPickers(handleError, { guest: isGuest = false } = {}) {
  onError = handleError || onError
  guest = isGuest
  addStyles()

  // Home page: swap the old picker (which opened a pop-up) for the shared one.
  const home = document.getElementById('mood')
  if (home) {
    home.querySelector('h2') && (home.querySelector('h2').textContent = TITLE)
    home.querySelector('.sub') && (home.querySelector('.sub').textContent = SUB)
    home.querySelector('.mood-controls')?.replaceWith(...buildPicker())
    home.querySelector('.notice')?.remove()
    home.append(el('p', { className: 'notice', textContent: NOTICE }))
  }

  // Journal: the same picker above "Express your feelings".
  const journal = document.getElementById('journal')
  if (journal && !journal.querySelector('.mood-checkin')) {
    const block = el('div', { className: 'mood-checkin center' }, el('h2', { textContent: TITLE }), el('p', { className: 'sub', textContent: SUB }), ...buildPicker(), el('p', { className: 'notice', textContent: NOTICE }))
    journal.prepend(block)
  }
}

// Returns [controls, status line]. Shows a few moods at a time with arrows.
function buildPicker() {
  let start = 0
  const row = el('div', { className: 'moods' })
  const status = el('p', { className: 'mood-status', role: 'status', ariaLive: 'polite' })
  const prev = el('button', { type: 'button', className: 'arrow', ariaLabel: 'Previous moods', textContent: '‹' })
  const next = el('button', { type: 'button', className: 'arrow', ariaLabel: 'More moods', textContent: '›' })
  const render = () => {
    const visible = visibleCount()
    start = Math.min(start, MOODS.length - visible)
    row.innerHTML = ''
    MOODS.slice(start, start + visible).forEach(([emoji, name]) => {
      const b = el('button', { type: 'button', className: 'mood', ariaLabel: `I feel ${name.toLowerCase()}` }, el('span', { textContent: emoji }), name)
      b.onclick = () => tap(b, emoji, name, status)
      row.append(b)
    })
    prev.disabled = start === 0
    next.disabled = start + visible >= MOODS.length
  }
  prev.onclick = () => { start = Math.max(0, start - 1); render() }
  next.onclick = () => { start = Math.min(MOODS.length - visibleCount(), start + 1); render() }
  narrow.addEventListener('change', render)
  render()
  return [el('div', { className: 'mood-controls' }, prev, row, next), status]
}

async function tap(button, emoji, name, status) {
  rise(button, emoji)
  status.textContent = QUOTES[name] || 'Thank you for checking in with yourself.'
  const now = new Date()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  if (guest) {
    // Visitors still get the reminder, and each tap reminds them that signing in keeps check-ins.
    onError(Object.assign(new Error('Please sign in first.'), { status: 401 }))
    return
  }
  try {
    await api('/api/moods', {
      method: 'POST',
      body: { mood: name, date: ymd(now), week: ymd(monday), created: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() },
    })
  } catch (err) {
    status.textContent = 'That tap could not be noted. Please try again.'
    onError(err)
  }
}

// The "sent" animation: the emoji floats up and fades, the button gives a small press.
function rise(button, emoji) {
  button.classList.remove('tapped')
  void button.offsetWidth
  button.classList.add('tapped')
  const r = button.getBoundingClientRect()
  const float = el('span', { className: 'mood-float', textContent: emoji, ariaHidden: 'true' })
  float.style.left = `${r.left + r.width / 2}px`
  float.style.top = `${r.top + r.height / 2 - 10}px`
  floatLayer().append(float)
  float.addEventListener('animationend', () => float.remove())
  setTimeout(() => float.remove(), 1500)
}

// A see-through layer over the whole page, above everything (titles, the top menu), for the rising emoji.
function floatLayer() {
  let layer = document.getElementById('mood-float-layer')
  if (!layer) {
    layer = el('div', { id: 'mood-float-layer', ariaHidden: 'true' })
    document.body.append(layer)
  }
  return layer
}

function addStyles() {
  if (document.getElementById('mood-checkin-style')) return
  const style = el('style', { id: 'mood-checkin-style' })
  style.textContent = `
.mood-checkin{margin-bottom:28px;padding-bottom:26px;border-bottom:1px solid var(--line,#e8dfed)}
.mood-checkin h2{margin-bottom:8px}
.mood-status{min-height:26px;margin:14px auto 0;max-width:780px;font-size:18px;font-weight:700;line-height:1.45;color:#5b4f7d}
.mood.tapped{animation:moodPress .35s ease}
.mood:disabled,.arrow:disabled{opacity:.35;cursor:default}
#mood-float-layer{position:fixed;inset:0;z-index:2147483647;pointer-events:none;isolation:isolate}
.mood-float{position:fixed;pointer-events:none;font-size:34px;transform:translate(-50%,-50%);animation:moodRise .95s ease-out forwards;will-change:transform,opacity}
#mood h2,#mood .sub,.mood-checkin h2,.mood-checkin .sub{position:relative;z-index:1}
.mood-controls{position:relative;z-index:2}
/* The row hides cards that are scrolled out of view; leave room so a lifted or pressed card is never cut off. */
.mood-controls .moods{padding:6px 3px;margin:-6px -3px}
@keyframes moodRise{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}70%{opacity:.9}100%{opacity:0;transform:translate(-50%,-150px) scale(1.6)}}
@keyframes moodPress{0%{transform:scale(1)}40%{transform:scale(.93)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.mood-float{animation-duration:.01s}.mood.tapped{animation:none}}`
  document.head.append(style)
}
