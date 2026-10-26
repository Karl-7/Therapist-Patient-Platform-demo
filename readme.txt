SAFE SPACE THERAPY: WEBSITE WITH ACCOUNTS

WHAT IS IN HERE
- index.html, about.html, booking.html, affirmations.html, contact.html
  The Private pages. Everyone must sign in first (once per device; "Keep me signed in" lasts 30 days).
- login.html      Sign in as Private or Doctor. Private people can create an account. Doctor accounts are invite-only.
- doctor.html     Doctor page: booking enquiries, clients (weekly AI summary + shared journal entries), affirmation library.
                  Open doctor.html?demo=1 to preview it with sample data (no sign-in, nothing saved).
- assets/         Page scripts (auth.js, private.js, doctor.js, login.js, dev-backend.js) and site.css.
- assets/build/   The bundled scripts the pages actually load. Rebuilt by `npm run build` (see below).
- netlify/functions/  The server side (Netlify Functions). Data is kept in Netlify Blobs.
- scripts/build.mjs   Bundles assets/*.js into assets/build/, and (on Netlify) copies the site into dist/.
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

DEBUG MODE (opening the site locally or from GitHub)
- When the site is opened as a file (double-click), from localhost, or from *.github.io, it runs in debug mode.
  On the Netlify site and on your own domain, debug mode is always off.
- Debug account (works as BOTH Private and Doctor; pick the role on the login page):
      email:    debug@safespace.test
      password: debug1234
- In debug mode nothing is sent anywhere: accounts, journals, bookings and affirmations are kept in this
  browser's localStorage. "Create account" also works, to add more test Private people.
- A small banner at the bottom shows debug mode is on; "Reset debug data" wipes it.
- On the Doctor page > Clients, "Debug: add sample AI summary" shows how a weekly summary looks.
- To test the real Netlify backend on localhost (netlify dev), open any page with ?live=1 (?live=0 to go back).
- doctor.html?demo=1 still shows the Doctor page filled with sample data.

EDITING THE SCRIPTS
- Edit the files in assets/*.js, then run:  npm install  (once)  and  npm run build
  This updates assets/build/, which the pages load. Commit assets/build/ too, so opening the files locally keeps working.
- Netlify runs `npm run build` on every deploy and publishes the dist/ folder (only the public site files).

BEFORE LAUNCH
- Confirm fees, services, the therapist bio, qualifications and languages.
- Journal entries are mental-health information (special category data under GDPR). Before real users join:
  add a privacy notice (what is stored, where, who can read it, the AI summary, how to delete), get clear consent
  for the AI summary, and check Netlify's data processing agreement and storage region.
- Google Analytics is not set up.

This is a supportive wellness website, not a clinical record system or an emergency service.
