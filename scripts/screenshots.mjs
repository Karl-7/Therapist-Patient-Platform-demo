// Re-takes the README screenshots (docs/screenshots/) with headless Google Chrome.
// 1. Serve the site locally:   python3 -m http.server 8765
// 2. Then run:                 npm run screenshots
// Uses debug mode and doctor.html?demo=1, so no real data is shown.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ORIGIN = process.argv[2] || 'http://localhost:8765'
const OUT = process.argv[3] || 'docs/screenshots'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PROFILE = mkdtempSync(join(tmpdir(), 'sst-shots-'))
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9333', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' })
let target
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200)
  try { target = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find((t) => t.type === 'page') } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const waiters = []
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method) waiters.filter((w) => w.method === msg.method).forEach((w) => { w.resolve(); waiters.splice(waiters.indexOf(w), 1) })
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id
  pending.set(n, (msg) => (msg.error ? reject(new Error(method + ': ' + msg.error.message)) : resolve(msg.result)))
  ws.send(JSON.stringify({ id: n, method, params }))
})
const waitFor = (method) => new Promise((resolve) => waiters.push({ method, resolve }))
const run = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
  return r.result.value
}
const size = (width, height, scale = 1.5, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile })
const go = async (path, settle = 900) => {
  const loaded = waitFor('Page.loadEventFired')
  await send('Page.navigate', { url: ORIGIN + path })
  await loaded
  await sleep(settle)
}
// Screenshot of the viewport, or of the page area from the top of `fromSel` to the bottom of `toSel`.
const shot = async (name, fromSel, toSel) => {
  let clip
  if (fromSel) {
    const box = await run(`const a=document.querySelector(${JSON.stringify(fromSel)}).getBoundingClientRect(); const b=document.querySelector(${JSON.stringify(toSel || fromSel)}).getBoundingClientRect(); return {x:Math.max(0,Math.min(a.left,b.left)-16), y:a.top+scrollY-16, width:Math.max(a.right,b.right)-Math.max(0,Math.min(a.left,b.left))+32, height:b.bottom-a.top+32}`)
    clip = { ...box, scale: 1 }
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  console.log('saved', name)
}
const noBanners = `document.getElementById('sstDevBanner')?.remove(); document.getElementById('demoBanner')?.remove(); document.querySelectorAll('.topbar').forEach(t=>t.style.position='static');`

await send('Page.enable')
await send('Runtime.enable')
await size(1200, 820)

// 1. Login
await go('/login.html')
await run(`localStorage.clear(); sessionStorage.clear();`)
await go('/login.html')
await shot('login', '.login-card')

// 2. Login with the debug box unlocked
await run(`const $=id=>document.getElementById(id); $('password').value='steffiroshan'; for (let i=0;i<5;i++){ $('submitBtn').click(); await new Promise(r=>setTimeout(r,60)) } ${noBanners}`)
await sleep(200)
await shot('login-debug', '.login-card')

// 3. Journal with the tidy-up review (Private: Sara, sample data)
await run(`localStorage.setItem('sst_dev_session', JSON.stringify({id:'sample-sara', email:'sara@example.test', name:'Sara Ahmed', roles:[], createdAt:'2026-09-14T00:00:00.000Z'}))`)
await go('/journal.html', 1200)
await run(`${noBanners} const $=id=>document.getElementById(id);
  $('journalText').value='Um so today the meeting ran late again and I felt really tense. I was furious with my manager. No wait, delete that. Uh I was just tired. In the evening I went for a walk and felt a lot calmer.';
  $('journalShare').checked = true; $('saveJournal').click();`)
await sleep(300)
await shot('journal-review', '#journal .mood-checkin', '#journal .grid2 > div:first-child .notice')

// 4. Doctor: booking enquiries (sample preview data)
await go('/doctor.html?demo=1', 1200)
await run(`${noBanners} document.querySelector('[data-tab=bookings]').click()`)
await sleep(500)
await shot('doctor-bookings', '#tab-bookings')

// 5. Doctor: a person's page (symptoms open, changes, mood chart, week boxes)
await run(`document.querySelector('[data-tab=clients]').click(); await new Promise(r=>setTimeout(r,500));
  document.querySelector('#clientList button').click(); await new Promise(r=>setTimeout(r,900));
  [...document.querySelectorAll('.client-actions button')].find(b=>b.innerText.startsWith('Symptoms')).click();`)
await sleep(600)
await shot('doctor-person', '#tab-clients', '.week-card:nth-of-type(3)')

// 6. Doctor: one week's page
await run(`[...document.querySelectorAll('.week-card')].find(c=>c.innerText.includes('3 shared')).click(); await new Promise(r=>setTimeout(r,300)); window.scrollTo(0,0)`)
await sleep(300)
await shot('doctor-week', '.client-head', '.week-page')

// 7. Doctor: affirmation library
await run(`document.querySelector('[data-tab=affirmations]').click()`)
await sleep(600)
await shot('doctor-affirmations', '#tab-affirmations')

// 8. Doctor on a phone
await size(390, 844, 2, true)
await go('/doctor.html?demo=1', 1200)
await run(`${noBanners} document.querySelector('[data-tab=clients]').click(); await new Promise(r=>setTimeout(r,500));
  document.querySelector('#clientList button').click(); await new Promise(r=>setTimeout(r,900));
  const y=document.querySelector('.client-head').getBoundingClientRect().top+scrollY-70; window.scrollTo(0,y);`)
await sleep(600)
await shot('doctor-mobile')

ws.close()
chrome.kill()
