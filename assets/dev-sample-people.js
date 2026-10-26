// Debug mode only: four made-up Private people, each with five full weeks of journal entries.
// Each week 3–6 days have an entry and 1–3 of those are shared with the doctor.
// All names and texts are invented. Password for every sample account: debug1234.

const POOLS = {
  en: {
    low: [
      'Woke up at 4am again and could not get back to sleep.',
      'Felt heavy all day, like everything took twice the effort.',
      'Snapped at someone I care about and felt guilty afterwards.',
      'Skipped lunch, too wound up to eat.',
      'Cried in the car before going inside.',
      'Kept replaying a conversation from yesterday in my head.',
      'Cancelled plans because I did not have the energy.',
      'My chest felt tight most of the afternoon.',
    ],
    mid: [
      'An ordinary day. Nothing great, nothing terrible.',
      'Got through most of my to-do list.',
      'Had a short walk at lunch, which helped a bit.',
      'Still tired, but less tense than last week.',
      'Talked to a friend on the phone for a while.',
      'Tried the breathing exercise before bed.',
      'A bit restless in the evening but managed to read.',
      'Some worry in the morning that faded by the afternoon.',
    ],
    high: [
      'Slept through the night for the first time in ages.',
      'Laughed a lot at dinner. Felt like myself.',
      'Went for a long walk and noticed the trees changing colour.',
      'Felt proud that I said no to extra work.',
      'A calm, easy day. I want more of these.',
      'Cooked a proper meal and enjoyed it.',
      'Felt hopeful about the next few weeks.',
      'Did the breathing exercise and it actually helped.',
    ],
    titles: ['Evening', 'Today', 'Quick note', 'Before bed'],
  },
  ar: {
    low: [
      'استيقظت في الرابعة فجرًا ولم أستطع النوم مرة أخرى.',
      'شعرت بثقل طوال اليوم، وكل شيء كان يحتاج جهدًا مضاعفًا.',
      'تشاجرت مع أخي على شيء صغير وندمت بعدها.',
      'لم آكل شيئًا تقريبًا اليوم.',
      'بقيت في غرفتي معظم اليوم ولم أرد على الهاتف.',
      'أفكار كثيرة في رأسي ولا أستطيع إيقافها.',
      'ألغيت موعدًا مع صديق لأنني لم أكن قادرًا.',
      'شعرت بضيق في صدري بعد الظهر.',
    ],
    mid: [
      'يوم عادي، لا شيء مميز.',
      'أنجزت معظم ما كان علي فعله.',
      'مشيت قليلًا بعد العصر وساعدني ذلك.',
      'ما زلت متعبًا لكن أقل توترًا من الأسبوع الماضي.',
      'تحدثت مع صديق على الهاتف لبعض الوقت.',
      'جربت تمرين التنفس قبل النوم.',
      'قلق خفيف في الصباح ثم هدأت.',
      'قرأت قليلًا في المساء.',
    ],
    high: [
      'نمت جيدًا لأول مرة منذ مدة طويلة.',
      'ضحكنا كثيرًا على العشاء مع العائلة.',
      'خرجت في نزهة طويلة وشعرت بالراحة.',
      'شعرت بالفخر لأنني أنهيت عملي في وقته.',
      'يوم هادئ وجميل.',
      'طبخت أكلة أحبها واستمتعت بها.',
      'أشعر بالأمل تجاه الأسابيع القادمة.',
      'تمرين التنفس ساعدني فعلًا اليوم.',
    ],
    titles: ['مساء', 'اليوم', 'ملاحظة سريعة', 'قبل النوم'],
  },
}

// mood: rough mood per week, oldest first (drives which sentences are picked).
const PEOPLE = [
  {
    id: 'sample-sara', name: 'Sara Ahmed', email: 'sara@example.test', lang: 'en', mood: [3, 4, 5, 6, 7],
    topics: ['Big deadline at work this week.', 'My manager asked for another report at 6pm.', 'Set myself a rule: no work emails after 7pm.', 'The project review went better than I feared.'],
  },
  {
    id: 'sample-omar', name: 'Omar Haddad', email: 'omar@example.test', lang: 'ar', mood: [6, 5, 3, 4, 6],
    topics: ['الوضع في البيت متوتر بسبب الخلافات.', 'والدي مريض وأنا قلق عليه.', 'زرت أهلي في نهاية الأسبوع.', 'تكلمت مع زوجتي بهدوء عن المشكلة.'],
  },
  {
    id: 'sample-lina', name: 'Lina Karim', email: 'lina@example.test', lang: 'en', mood: [5, 3, 6, 4, 7],
    topics: ['Had that racing-heart feeling again at the bus stop.', 'Meeting new people at the course made me nervous.', 'I think I am getting better at noticing the anxiety early.', 'My sister came to visit and we went to the market.'],
  },
  {
    id: 'sample-yusuf', name: 'Yusuf Nasser', email: 'yusuf@example.test', lang: 'ar', mood: [4, 4, 5, 5, 6],
    topics: ['الامتحانات قريبة وأنا متوتر.', 'ذاكرت في المكتبة مع زملائي.', 'أحاول أن أنام في وقت ثابت كل ليلة.', 'قدمت عرضًا في الجامعة ومر بشكل جيد.'],
  },
]

// Small seeded random generator, so the sample data looks the same after every reset.
function rng(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Adds the sample people, their entries and two booking enquiries to the debug database.
export function addSamplePeople(db, weekOf, newId) {
  const rand = rng(20261026)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const pickSome = (list, n) => [...list].sort(() => rand() - 0.5).slice(0, n)

  const thisMonday = new Date()
  thisMonday.setHours(0, 0, 0, 0)
  thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7))

  for (const person of PEOPLE) {
    if (db.accounts.some((a) => a.id === person.id)) continue
    const joined = new Date(thisMonday)
    joined.setDate(joined.getDate() - 7 * 6)
    db.accounts.push({ id: person.id, email: person.email, password: 'debug1234', name: person.name, createdAt: joined.toISOString() })
    const pool = POOLS[person.lang]

    // Five complete weeks, ending last Sunday.
    person.mood.forEach((mood, i) => {
      const monday = new Date(thisMonday)
      monday.setDate(monday.getDate() - 7 * (5 - i))
      const days = pickSome([0, 1, 2, 3, 4, 5, 6], 3 + Math.floor(rand() * 4)).sort((a, b) => a - b)
      const shared = new Set(pickSome(days, Math.min(days.length, 1 + Math.floor(rand() * 3))))
      days.forEach((day) => {
        const d = new Date(monday)
        d.setDate(d.getDate() + day)
        d.setHours(19 + Math.floor(rand() * 4), Math.floor(rand() * 60))
        const m = mood + Math.round(rand() * 2 - 1)
        const band = m <= 4 ? pool.low : m >= 7 ? pool.high : pool.mid
        const parts = [rand() < 0.6 ? pick(person.topics) : null, pick(band), rand() < 0.5 ? pick(band) : null].filter(Boolean)
        const text = [...new Set(parts)].join(' ')
        const created = d.toISOString()
        db.journals.push({ id: newId(), userId: person.id, title: rand() < 0.3 ? pick(pool.titles) : '', text, shared: shared.has(day), created, week: weekOf(created) })
        db.queue[`${person.id}/${weekOf(created)}`] = Date.now()
      })
    })
  }

  if (!db.bookings.some((b) => b.userId?.startsWith('sample-'))) {
    const at = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString()
    db.bookings.push(
      { id: newId(), userId: 'sample-lina', accountEmail: 'lina@example.test', name: 'Lina Karim', email: 'lina@example.test', service: 'Individual Therapy', session: 'Online session', date: '', message: 'Evenings work best for me.', status: 'new', note: '', created: at(1) },
      { id: newId(), userId: 'sample-omar', accountEmail: 'omar@example.test', name: 'Omar Haddad', email: 'omar@example.test', service: 'Marriage Counselling', session: 'Individual session', date: '', message: '', status: 'contacted', note: 'Offered Tuesday or Thursday.', created: at(6) },
    )
  }
}
