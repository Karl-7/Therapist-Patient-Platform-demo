// AI weekly summary worker. Runs on the EC2 server at boot (safespace-worker.service), then the server powers off.
// Needs Node 18+ and Ollama. No npm packages.
// Settings come from /etc/safespace-worker.env:
//   SITE_URL          https://your-site.netlify.app
//   WORKER_KEY        same value as SUMMARY_WORKER_KEY in Netlify
//   MODEL             e.g. qwen3.5:4b
//   SUMMARY_LANGUAGE  language the doctor reads (default English)
// Run by hand for testing:  sudo FORCE=1 /usr/bin/node /opt/safespace-worker/worker.mjs   (FORCE=1 = run even if no doctor asked)
import { mkdirSync, writeFileSync } from 'node:fs'

const SITE = (process.env.SITE_URL || '').replace(/\/+$/, '')
const KEY = process.env.WORKER_KEY || ''
const MODEL = process.env.MODEL || 'qwen3.5:4b'
const LANGUAGE = process.env.SUMMARY_LANGUAGE || 'English'
const OLLAMA = 'http://127.0.0.1:11434'
// systemd sets RUNTIME_DIRECTORY (/run/safespace-worker) from RuntimeDirectory= in the service file.
const RUN_DIR = process.env.RUNTIME_DIRECTORY || '/run/safespace-worker'
const POWEROFF_FLAG = `${RUN_DIR}/poweroff`
const MAX_INPUT_CHARS = 40000

const log = (...a) => console.log(new Date().toISOString(), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function site(action, body = {}) {
  const res = await fetch(`${SITE}/api/worker/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-worker-key': KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${action}: ${res.status} ${data.error || ''}`)
  return data
}

async function waitForOllama() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${OLLAMA}/api/tags`)).ok) return
    } catch {}
    await sleep(3000)
  }
  throw new Error('Ollama did not start')
}

const SYSTEM = `You write short weekly notes for a therapist about one person's private journal.
Rules:
- Write in ${LANGUAGE}, even if the journal is in another language (for example Arabic).
- "mood": a whole number from 1 (very low) to 10 (very good) for the person's overall mood this week, judged only from what they wrote.
- "summary": at most 100 words. Main feelings, events and themes of this week, in plain neutral language.
- "comparison": at most 50 words. How this week differs from the previous week. If there is no previous week, say this is the first week with entries.
- "changes": 2 to 5 short points (max 20 words each) on what changed this week compared with the previous three weeks (mood, sleep, relationships, work, recurring worries...). If there are no earlier weeks, return an empty list.
- Some days only have a "Mood check-in": the person tapped mood buttons without writing. Use these too, especially for the mood score.
- Describe only what the person wrote or tapped. Do not diagnose, do not give advice, do not guess.
- If any entry mentions self-harm, suicide, or harming someone, begin the summary with "Safety note:" and state it plainly, and make it the first point in "changes".
Reply with JSON only: {"mood": 5, "summary": "...", "comparison": "...", "changes": ["...", "..."]}`

function buildPrompt(week, entries, earlier) {
  let journal = entries
    .map((e) => e.kind === 'mood'
      ? `[${new Date(e.created).toUTCString().slice(0, 16)}] Mood check-in (tapped by the person, no writing): ${e.text}`
      : `[${new Date(e.created).toUTCString().slice(0, 16)}]${e.title ? ' ' + e.title + ':' : ''}\n${e.text}`)
    .join('\n\n')
  if (journal.length > MAX_INPUT_CHARS) journal = journal.slice(0, MAX_INPUT_CHARS) + '\n[...cut for length]'
  const past = earlier.length
    ? earlier.map((w) => `- Week starting ${w.week} (mood ${w.mood ?? '?'}/10): ${w.summary}`).join('\n')
    : '(none)'
  const written = entries.filter((e) => e.kind !== 'mood').length
  const checkins = entries.length - written
  return `This week starts ${week}. ${written} journal ${written === 1 ? 'entry' : 'entries'}, ${checkins} day${checkins === 1 ? '' : 's'} with a mood check-in.

Earlier weeks, most recent first (up to three):
${past}

This week's journal entries:
${journal}`
}

const limitWords = (text, n) => {
  const words = String(text || '').trim().split(/\s+/)
  return words.length > n ? words.slice(0, n).join(' ') + '…' : words.join(' ')
}

async function summarize(week, entries, earlier) {
  let res = await chat(week, entries, earlier, false)
  // Models without a thinking mode may reject the "think" option; try again without it.
  if (res.status === 400) res = await chat(week, entries, earlier, undefined)
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`)
  const content = (await res.json())?.message?.content || ''
  const data = JSON.parse(content.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/)?.[0] || '{}')
  if (!data.summary) throw new Error('Model reply had no summary')
  const mood = Math.min(10, Math.max(1, Math.round(Number(data.mood) || 5)))
  const changes = (Array.isArray(data.changes) ? data.changes : []).map((c) => limitWords(c, 25)).filter(Boolean).slice(0, 5)
  return { mood, summary: limitWords(data.summary, 110), comparison: limitWords(data.comparison, 60), changes }
}

function chat(week, entries, earlier, think) {
  return fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15 * 60 * 1000),
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think,
      format: {
        type: 'object',
        properties: { mood: { type: 'integer' }, summary: { type: 'string' }, comparison: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } } },
        required: ['mood', 'summary', 'comparison', 'changes'],
      },
      options: { temperature: 0.2, num_ctx: 16384 },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildPrompt(week, entries, earlier) },
      ],
    }),
  })
}

async function main() {
  if (!SITE || KEY.length < 32) throw new Error('SITE_URL and WORKER_KEY must be set in /etc/safespace-worker.env')
  const { requested } = await site('begin')
  if (requested) {
    // Tells systemd to power the server off afterwards, even if something below fails.
    mkdirSync(RUN_DIR, { recursive: true })
    writeFileSync(POWEROFF_FLAG, '1')
  } else if (!process.env.FORCE) {
    log('Started by hand (no doctor request). Not running and not powering off. Use FORCE=1 to run anyway.')
    return
  }

  await waitForOllama()
  const exclude = []
  let lastError = null
  let done = 0
  try {
    for (;;) {
      const next = await site('next', { exclude })
      if (next.done) break
      const { item, entries, earlier = [] } = next
      log(`Summarising ${item.key} (${entries.length} entries, ${next.remaining} left)`)
      try {
        if (!entries.length) {
          await site('summary', { userId: item.userId, week: item.week, changedAt: item.changedAt, empty: true })
        } else {
          const started = Date.now()
          const out = await summarize(item.week, entries, earlier)
          const entryCount = entries.filter((e) => e.kind !== 'mood').length
          await site('summary', { userId: item.userId, week: item.week, changedAt: item.changedAt, entryCount, model: MODEL, ...out })
          log(`  done in ${Math.round((Date.now() - started) / 1000)} s`)
        }
        done++
      } catch (err) {
        lastError = `${item.key}: ${err.message}`
        log('  failed:', lastError)
        exclude.push(item.key)
      }
    }
  } finally {
    await site('end', { error: lastError }).catch((e) => log('end failed:', e.message))
    log(`Finished. ${done} week(s) summarised${exclude.length ? `, ${exclude.length} failed` : ''}.`)
  }
}

main().catch((err) => {
  log('Worker error:', err.message)
  site('end', { error: err.message }).catch(() => {})
  process.exitCode = 1
})
