// Login page: Private / Doctor sign-in, sign-up, password reset and invite links.
import { DEV, currentUser, isDoctor, signIn, signOut, signUp, requestPasswordRecovery, handleAuthCallback, acceptInvite, updatePassword } from './auth.js'
import { DEBUG_EMAIL, DEBUG_PASSWORD, showDevBanner } from './dev-backend.js'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
let role = params.get('as') === 'doctor' ? 'doctor' : 'private'
let mode = 'signin' // signin | signup | forgot | invite | recovery
let inviteToken = null

const reasons = {
  'signed-out': 'You have been signed out.',
  'not-doctor': 'That account does not have doctor access.',
  'is-doctor': 'This is a doctor account. Please sign in as Doctor.',
  expired: 'Your session has ended. Please sign in again.',
}

function setStatus(text, kind = '') {
  $('status').textContent = text
  $('status').className = 'status' + (kind ? ' ' + kind : '')
}

function render() {
  document.querySelectorAll('[data-role]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.role === role)))
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)))
  const special = mode === 'invite' || mode === 'recovery'
  $('roleBlock').classList.toggle('hidden', special)
  $('privateTabs').classList.toggle('hidden', role !== 'private' || mode === 'forgot')
  $('nameRow').classList.toggle('hidden', !(role === 'private' && mode === 'signup'))
  $('emailRow').classList.toggle('hidden', special)
  $('passwordRow').classList.toggle('hidden', mode === 'forgot')
  $('rememberRow').classList.toggle('hidden', mode === 'signup' || mode === 'forgot')
  $('forgotBtn').textContent = mode === 'forgot' ? '← Back to sign in' : 'Forgot password?'
  $('forgotBtn').classList.toggle('hidden', special || mode === 'signup')
  $('doctorNote').classList.toggle('hidden', role !== 'doctor' || mode !== 'signin')
  $('password').autocomplete = mode === 'signin' ? 'current-password' : 'new-password'

  const copy = {
    signin: [role === 'doctor' ? 'Doctor sign in' : 'Sign in', role === 'doctor' ? 'View booking enquiries, weekly summaries and the affirmation library.' : 'Your journal is saved to your account, on every device.', 'Sign in'],
    signup: ['Create your account', 'A private space for your journal. Only you can read entries you do not share.', 'Create account'],
    forgot: ['Reset your password', 'We will email you a link to choose a new password.', 'Send reset link'],
    invite: ['Set up your account', 'You have been invited to Safe Space Therapy. Choose a password to finish.', 'Save password'],
    recovery: ['Choose a new password', 'Enter a new password for your account.', 'Save new password'],
  }[mode]
  $('loginTitle').textContent = copy[0]
  $('loginSub').textContent = copy[1]
  $('submitBtn').textContent = copy[2]
}

function destination(user) {
  if (isDoctor(user)) return 'doctor.html'
  const next = params.get('next')
  return next && /^[a-z-]+\.html$/.test(next) && next !== 'doctor.html' ? next : 'index.html'
}

// Signs out and explains when the account does not match the chosen role.
async function enter(user) {
  if (role === 'doctor' && !isDoctor(user)) {
    await signOut()
    return setStatus(reasons['not-doctor'], 'error')
  }
  if (role === 'private' && isDoctor(user)) {
    await signOut()
    return setStatus(reasons['is-doctor'], 'error')
  }
  location.replace(destination(user))
}

const friendly = (err) => {
  const msg = String(err?.message || err || '')
  if (/invalid_grant|No user found|Invalid Password|invalid login/i.test(msg)) return 'Email or password is incorrect.'
  if (/not confirmed|Email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.'
  if (/already (been )?registered|already exists/i.test(msg)) return 'An account with this email already exists. Try signing in.'
  if (/Signups not allowed|signup.*disabled/i.test(msg)) return 'New accounts are not open right now.'
  if (/Identity|MissingIdentity|404|Unsupported method|Failed to fetch|Unexpected token/i.test(msg)) return 'Sign-in is not available yet. Netlify Identity needs to be turned on for this site.'
  return msg || 'Something went wrong. Please try again.'
}

document.querySelectorAll('[data-role]').forEach((b) => (b.onclick = () => { role = b.dataset.role; mode = 'signin'; setStatus(''); render() }))
document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { mode = b.dataset.mode; setStatus(''); render() }))
$('forgotBtn').onclick = () => { mode = mode === 'forgot' ? 'signin' : 'forgot'; setStatus(''); render() }

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  if (debugUnlockClick()) return
  const email = $('email').value.trim()
  const password = $('password').value
  if (mode !== 'invite' && mode !== 'recovery' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setStatus('Please enter a valid email.', 'error')
  if (mode !== 'forgot' && password.length < 8) return setStatus('Password needs at least 8 characters.', 'error')

  $('submitBtn').disabled = true
  setStatus('Please wait…')
  try {
    if (mode === 'signin') {
      await enter(await signIn(email, password, $('remember').checked, role))
    } else if (mode === 'signup') {
      const user = await signUp(email, password, $('name').value.trim())
      if (user?.confirmedAt) return enter(user)
      mode = 'signin'
      render()
      setStatus('Account created. Check your email and click the confirmation link, then sign in here.', 'ok')
    } else if (mode === 'forgot') {
      await requestPasswordRecovery(email)
      setStatus('If that email has an account, a reset link is on its way.', 'ok')
    } else if (mode === 'invite') {
      const user = await acceptInvite(inviteToken, password)
      role = isDoctor(user) ? 'doctor' : 'private'
      await enter(user)
    } else if (mode === 'recovery') {
      const user = await updatePassword(password)
      role = isDoctor(user) ? 'doctor' : 'private'
      await enter(user)
    }
  } catch (err) {
    setStatus(friendly(err), 'error')
  } finally {
    $('submitBtn').disabled = false
  }
})

async function start() {
  render()
  if (DEV && sessionUnlocked()) setupDebugBox()
  if (reasons[params.get('reason')]) setStatus(reasons[params.get('reason')], params.get('reason') === 'signed-out' ? 'ok' : 'error')

  // Finish links from Identity emails (invite, confirm, password reset).
  if (/_token=/.test(location.hash)) {
    try {
      const result = await handleAuthCallback()
      history.replaceState(null, '', location.pathname + location.search)
      if (result?.type === 'invite' && result.token) {
        inviteToken = result.token
        mode = 'invite'
        return render()
      }
      if (result?.type === 'recovery') {
        mode = 'recovery'
        return render()
      }
      if (result?.user) {
        role = isDoctor(result.user) ? 'doctor' : 'private'
        return enter(result.user)
      }
    } catch (err) {
      return setStatus('This link has expired or was already used. ' + friendly(err), 'error')
    }
  }

  // Already signed in on this device: go straight in.
  if (!params.get('reason')) {
    const user = await currentUser().catch(() => null)
    if (user) {
      role = isDoctor(user) ? 'doctor' : 'private'
      location.replace(destination(user))
    }
  }
}
start()

// Debug mode only (local / GitHub Pages): one account that signs in as Private or Doctor.
// The box is hidden until someone types the unlock word in the password field and presses
// "Sign in" 5 times in a row. This only tidies the screen; it is not a security feature
// (debug mode never runs on the Netlify site, and its data never leaves the browser).
const UNLOCK_WORD = 'steffiroshan'
const UNLOCK_CLICKS = 5
let unlockClicks = 0
const sessionUnlocked = () => { try { return sessionStorage.getItem('sst_debug_unlocked') === '1' } catch { return false } }

function debugUnlockClick() {
  if (!DEV || $('password').value !== UNLOCK_WORD) {
    unlockClicks = 0
    return false
  }
  unlockClicks++
  if (unlockClicks < UNLOCK_CLICKS) {
    setStatus('Email or password is incorrect.', 'error')
    return true
  }
  unlockClicks = 0
  try { sessionStorage.setItem('sst_debug_unlocked', '1') } catch {}
  $('password').value = ''
  setStatus('')
  setupDebugBox()
  return true
}

function setupDebugBox() {
  if (document.querySelector('.debug-box')) return
  showDevBanner()
  const box = document.createElement('div')
  box.className = 'debug-box'
  box.innerHTML = '<strong>Debug mode</strong><span>Netlify sign-in is not available here, so a local debug account is used. It works for both Private and Doctor.</span>'
  const creds = document.createElement('code')
  creds.textContent = `${DEBUG_EMAIL} / ${DEBUG_PASSWORD}`
  const fill = document.createElement('button')
  fill.type = 'button'
  fill.className = 'btn secondary small'
  fill.textContent = 'Use debug account'
  fill.onclick = () => {
    mode = 'signin'
    render()
    $('email').value = DEBUG_EMAIL
    $('password').value = DEBUG_PASSWORD
    $('submitBtn').focus()
  }
  box.append(creds, fill)
  $('authForm').before(box)
}
