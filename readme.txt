SAFE SPACE THERAPY: WEBSITE WITH ACCOUNTS

WHAT IS IN HERE
- index.html, about.html, booking.html, affirmations.html, contact.html
  The Private pages. Everyone must sign in first (once per device; "Keep me signed in" lasts 30 days).
- login.html      Sign in as Private or Doctor. Private people can create an account. Doctor accounts are invite-only.
- doctor.html     Doctor page: booking enquiries, clients (weekly AI summary + shared journal entries), affirmation library.
                  Open doctor.html?demo=1 to preview it with sample data (no sign-in, nothing saved).
- assets/         Shared scripts and styles (auth.js, private.js, doctor.js, site.css, vendor/netlify-identity.js).
- netlify/functions/  The server side (Netlify Functions). Data is kept in Netlify Blobs.
- affirmations.json   Old reference copy. The live list is now edited on the Doctor page.

WHERE DATA IS STORED (all on Netlify)
- Accounts: Netlify Identity. A Doctor is a user with the role "doctor".
- Journal entries: Netlify Blobs, store "journals", key "<userId>/<entryId>".
    { id, userId, title, text, shared (true/false), created (ISO date), week (Monday of that week, YYYY-MM-DD) }
- Booking enquiries: store "bookings".
- Affirmation library: store "site", key "affirmations".
- Weekly AI summaries: store "summaries", key "<userId>/<week>". The site only READS these.
    { week: "2026-10-19", summary: "...", comparison: "...", entryCount: 5, generatedAt: "<ISO date>" }
- Favourites are still saved only in each browser (not in the account).

WHO SEES WHAT
- A Private user sees only their own journal.
- The Doctor sees: booking enquiries, the list of Private accounts, the entries each person chose to share,
  and the weekly AI summary. The Doctor never receives entries that were not shared.
- The journal page tells users that the weekly AI summary covers all their entries, shared or not.

THE WEEKLY AI SUMMARY (separate service, not part of this site)
Your AI service should, once a week, for each user:
  1. read that user's entries for the week from the "journals" store (all of them, shared or not),
  2. write one summary object to the "summaries" store under "<userId>/<week>", comparing with the previous week.
It can use the @netlify/blobs package with getStore({ name, siteID, token }) and a Netlify personal access token.

ONE-TIME SETUP ON NETLIFY
1. Deploy from Git (this repository). Drag-and-drop deploys do NOT include the Functions, so sign-in and saving will not work.
2. Netlify dashboard > your site > Identity (under "Project configuration"/"Security"): Enable Identity.
3. Identity > Registration: "Open" (so Private users can sign up). Keep email confirmation ON.
4. Create the Doctor account: Identity > Invite users > enter the doctor's email.
   After they accept the invite, open the user > Edit > Roles: type  doctor  and save.
   The doctor then signs in on login.html with "Doctor" selected.
5. Optional: Identity > Emails, to change the invite / confirmation / reset email texts.

LOCAL PREVIEW
- python3 -m http.server 8765   then open http://localhost:8765/doctor.html?demo=1 for the Doctor preview.
- Real sign-in and saving only work on the Netlify site (or with "netlify dev" linked to the site).
- If you change the Identity library version: npm install, then npm run build:vendor.

BEFORE LAUNCH
- Confirm fees, services, the therapist bio, qualifications and languages.
- Journal entries are mental-health information (special category data under GDPR). Before real users join:
  add a privacy notice (what is stored, where, who can read it, the AI summary, how to delete), get clear consent
  for the AI summary, and check Netlify's data processing agreement and storage region.
- Google Analytics is not set up.

This is a supportive wellness website, not a clinical record system or an emergency service.
