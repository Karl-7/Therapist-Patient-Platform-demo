// Daily mood check-ins (the "How are you feeling today?" buttons).
// Every tap is counted for that day. The counts become one hidden line at the top of that day's
// journal, e.g. 3 x Happy + 1 x Sad -> "I feel very happy and a bit sad today."
// The person never sees this line; it is only used for the weekly AI summary.

export const MOODS = [
  ['😊', 'Happy'], ['😔', 'Sad'], ['😟', 'Anxious'], ['😣', 'Stressed'], ['😵', 'Overwhelmed'],
  ['😞', 'Lonely'], ['😐', 'Okay'], ['🙂', 'Good'], ['🌞', 'Great'],
]
export const MOOD_NAMES = MOODS.map(([, name]) => name)

// 1 tap -> "a bit", 2 -> "quite", 3 or more -> "very".
// If every mood was tapped only once, no strength words are added ("I feel happy and anxious today.").
export function moodSentence(counts, order = Object.keys(counts)) {
  const names = [...new Set(order)].filter((m) => counts[m] > 0)
  if (!names.length) return ''
  names.sort((a, b) => counts[b] - counts[a] || order.indexOf(a) - order.indexOf(b))
  const showStrength = names.some((m) => counts[m] > 1)
  const word = (m) => (showStrength ? (counts[m] >= 3 ? 'very ' : counts[m] === 2 ? 'quite ' : 'a bit ') : '') + m.toLowerCase()
  const parts = names.map(word)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `I feel ${list} today.`
}
