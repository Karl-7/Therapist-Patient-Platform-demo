// Sign-in helpers shared by every page (Netlify Identity).
import * as identity from './vendor/netlify-identity.js'

export const DOCTOR_ROLE = 'doctor'
const REMEMBER_KEY = 'sst_remember'
const KEEP_DAYS = 30

export const isDoctor = (user) => Array.isArray(user?.roles) && user.roles.includes(DOCTOR_ROLE)

const safe = (fn, fallback = null) => {
  try { return fn() } catch { return fallback }
}

export const getRemember = () => safe(() => localStorage.getItem(REMEMBER_KEY) === '1', false)
export const setRemember = (on) => safe(() => (on ? localStorage.setItem(REMEMBER_KEY, '1') : localStorage.removeItem(REMEMBER_KEY)))

const readCookie = (name) => {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}
const writeCookie = (name, value, days) => {
  const secure = location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; samesite=lax${secure}; max-age=${days * 86400}`
}

// The Identity library uses session cookies, which the browser drops when it closes.
// "Keep me signed in" turns them into 30-day cookies on this device.
function keepCookies() {
  if (!getRemember()) return
  const jwt = readCookie('nf_jwt')
  const refresh = readCookie('nf_refresh')
  if (jwt) writeCookie('nf_jwt', jwt, KEEP_DAYS)
  if (refresh) writeCookie('nf_refresh', refresh, KEEP_DAYS)
}

// If the cookies were lost but the saved session is still here, put them back.
function restoreCookies() {
  if (!getRemember() || readCookie('nf_jwt')) return
  const saved = safe(() => JSON.parse(localStorage.getItem('gotrue.user')))
  const token = saved?.token
  if (token?.access_token) writeCookie('nf_jwt', token.access_token, KEEP_DAYS)
  if (token?.refresh_token) writeCookie('nf_refresh', token.refresh_token, KEEP_DAYS)
}

identity.onAuthChange((event) => {
  if (event === 'login' || event === 'token_refresh') keepCookies()
})

// Returns the signed-in user with a fresh token, or null.
export async function currentUser() {
  restoreCookies()
  const user = await identity.getUser()
  if (!user) return null
  try {
    await identity.refreshSession()
  } catch {
    // Keep going: the server will answer 401 if the session really ended.
  }
  keepCookies()
  return user
}

export async function signIn(email, password, remember) {
  setRemember(remember)
  const user = await identity.login(email, password)
  keepCookies()
  return user
}

export async function signOut() {
  setRemember(false)
  try {
    await identity.logout()
  } catch {
    // Cookies are cleared even if the network call fails.
  }
}

export const signUp = (email, password, name) => identity.signup(email, password, name ? { full_name: name } : undefined)
export const requestPasswordRecovery = (email) => identity.requestPasswordRecovery(email)
export const handleAuthCallback = () => identity.handleAuthCallback()
export const acceptInvite = (token, password) => identity.acceptInvite(token, password)
export const updatePassword = (password) => identity.updateUser({ password })

// Links in Netlify Identity emails point at the site root (#invite_token=..., #confirmation_token=...).
// Send them on to the login page, which knows how to finish them.
export function forwardAuthLinks() {
  if (/(invite|confirmation|recovery|email_change)_token=|access_token=/.test(location.hash) && !location.pathname.endsWith('/login.html')) {
    location.replace('login.html' + location.hash)
    return true
  }
  return false
}

export const loginUrl = (as, reason) => {
  const p = new URLSearchParams({ as })
  const here = location.pathname.split('/').pop() || 'index.html'
  if (as === 'private' && here !== 'login.html') p.set('next', here)
  if (reason) p.set('reason', reason)
  return 'login.html?' + p
}

// Fetch wrapper for /api/*. Sends cookies, throws a readable Error on failure.
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}
