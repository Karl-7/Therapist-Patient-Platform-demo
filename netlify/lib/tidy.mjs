// "Tidy up" for journal text dictated with a phone keyboard.
// Only ever DELETES words (fillers, "wait, delete that" and what it cancels). Never adds or rewrites.
// Runs in the browser (bundled into assets/build/private.js). Nothing is sent to a server.

const SENTENCE_END = /[.!?。…؟\n]$/
const MAX_LOOKBACK = 25 // words a "delete that" may remove when there is no punctuation

const FILLER_EN = /^(u+h+m*|u+m+|e+r+m*|e+m+|a+h+|h+m+|m{2,})$/
const FILLER_AR = /^([اإأ]?م{2,}|ا{3,}|[اإأ]?ه{2,}م*)$/

// "delete/scratch/strike/cut/ignore that|this" and Arabic "احذف/امسح/تجاهل ذلك|هذا|هذه"
const DELETE_VERBS = new Set(['delete', 'scratch', 'strike', 'cut', 'ignore', 'erase', 'remove', 'احذف', 'امسح', 'تجاهل', 'شيل'])
const DELETE_OBJECTS = new Set(['that', 'this', 'it', 'ذلك', 'هذا', 'هذه', 'هذي', 'ذاك'])
// Words that often come just before a command ("no wait, delete that").
const LEAD_INS = new Set(['no', 'wait', 'oh', 'actually', 'sorry', 'ok', 'okay', 'لا', 'لحظة', 'عفوا', 'آسف', 'اسف', 'طيب'])

export const tokenize = (text) => String(text || '').trim().match(/\S+\s*/g) || []

export const core = (token) =>
  token.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[ً-ْـ]/g, '')

// Simple, predictable rules. The person reviews every suggestion before saving.
export function ruleDeletions(tokens) {
  const words = tokens.map(core)
  const out = []

  words.forEach((w, i) => {
    if (w && (FILLER_EN.test(w) || FILLER_AR.test(w))) out.push({ from: i, to: i, type: 'filler', reason: 'Filler sound' })
  })

  for (let i = 0; i < words.length - 1; i++) {
    if (!DELETE_VERBS.has(words[i]) || !DELETE_OBJECTS.has(words[i + 1])) continue
    let cmdStart = i
    while (cmdStart > 0 && LEAD_INS.has(words[cmdStart - 1])) cmdStart--
    const cmdEnd = i + 1
    // Remove the sentence just before the command.
    let start = cmdStart
    if (cmdStart > 0) {
      start = cmdStart - 1
      while (start > 0 && cmdStart - start < MAX_LOOKBACK && !SENTENCE_END.test(tokens[start - 1].trim())) start--
    }
    out.push({ from: start, to: cmdEnd, type: 'correction', reason: start < cmdStart ? '“Delete that” and what it refers to' : 'Spoken command' })
    i = cmdEnd
  }
  return out
}

// Sorts, clamps and merges overlapping ranges.
export function mergeDeletions(list, count) {
  const clean = list
    .filter((d) => Number.isInteger(d?.from) && Number.isInteger(d?.to))
    .map((d) => ({ from: Math.max(0, Math.min(d.from, d.to)), to: Math.min(count - 1, Math.max(d.from, d.to)), type: d.type || 'other', reason: String(d.reason || '').slice(0, 160) }))
    .filter((d) => d.from <= d.to && d.from < count)
    .sort((a, b) => a.from - b.from || b.to - a.to)
  const merged = []
  for (const d of clean) {
    const last = merged[merged.length - 1]
    if (last && d.from <= last.to) {
      last.to = Math.max(last.to, d.to)
      if (last.type === 'filler' && d.type !== 'filler') Object.assign(last, { type: d.type, reason: d.reason })
    } else merged.push({ ...d })
  }
  return merged
}

// Joins the kept words back into text.
// Only where something was removed at the start of a sentence is the next word capitalised
// ("Um it was fine" -> "It was fine"). Everything else, links included, keeps its original letters.
export function applyDeletions(tokens, deletions) {
  const drop = new Set()
  deletions.forEach((d) => { for (let i = d.from; i <= d.to; i++) drop.add(i) })
  const kept = []
  let afterRemoval = false
  tokens.forEach((token, i) => {
    if (drop.has(i)) return void (afterRemoval = true)
    const prev = kept[kept.length - 1]
    const sentenceStart = !prev || SENTENCE_END.test(prev.trim())
    const looksLikeLink = /^(https?:|www\.|\S+@\S+)/i.test(token)
    kept.push(afterRemoval && sentenceStart && !looksLikeLink ? token.replace(/^([^\p{L}]*)(\p{Ll})/u, (_, lead, letter) => lead + letter.toUpperCase()) : token)
    afterRemoval = false
  })
  return kept.join('').replace(/[ \t]+([,.!?;:،؛؟])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim().replace(/^[,.;:،؛\s]+/, '')
}
