# Authorization

Identity is the signed-in account (`kit/staff`); every action is attributed to that person's email, not to a workstation. The matrix below is `src/domain/permissions.js`, and the tests walk it. The checks live in `src/app`, so no page can skip them.

| Permission | Staff | Manager | Owner |
| --- | :-: | :-: | :-: |
| See and search calls, customers, items | ✓ | ✓ | ✓ |
| Start, edit, claim, park, resume, ask for help, finish, reopen a call | ✓ | ✓ | ✓ |
| Add and edit customers, add contacts | ✓ | ✓ | ✓ |
| Add an item | ✓ | ✓ | ✓ |
| Nudge a coworker, print a call | ✓ | ✓ | ✓ |
| Look up a vehicle, find parts, say whether a part worked, teach a part number | ✓ | ✓ | ✓ |
| See AI use and part-finder statistics | | ✓ | ✓ |
| Enter measurements, add photos and make a customer link on a call | ✓ | ✓ | ✓ |
| Watch a coworker's call and suggest a part (once switched on) | ✓ | ✓ | ✓ |
| Switch watching on or off for the shop | | ✓ | ✓ |
| Hand a call back that someone else holds, assign calls | | ✓ | ✓ |
| Edit or retire an item | | ✓ | ✓ |
| Mark a customer inactive | | ✓ | ✓ |
| Reports, CSV, activity log | | ✓ | ✓ |
| Invite people, set roles, reset passwords, turn accounts off | | | ✓ |

Rules that go with it:

- Nobody signed in can do anything; every page except sign-in, `/healthz` and the service worker redirects to sign-in.
- A nudge is private to the person it is for: only they see it, receive it live or by push, or can dismiss it. Push subscriptions belong to one account and only that account can remove them. `/metrics` doesn't exist without its token; `/sw.js` is public and contains no data.
- Posts must come from this site (`Origin`, or `Sec-Fetch-Site` where a page sends `Origin: null`).
- Messages after a form are signed, so a crafted link can't put words in an alert box.
- Everything a person types is escaped on the way out. The page's Content-Security-Policy allows scripts only from this site and from Zubra's own, by nonce.
- A coworker's newer edit to a call is never overwritten: saves carry the revision they started from and a stale one is refused.
- Watching is off until a manager or owner turns it on, and turning it off ends every watch. The person being watched is always shown who is watching; each watch leaves an activity-log line (at most one per ten minutes per person per call). Watchers see the call but can't change it; a suggestion is only a card until the person working the call (or a manager) accepts it.
- The customer link is the one place without a sign-in. It opens a single request, for 48 hours, and can only add measurements, a note and photos; it cannot read anything. Only a hash of the link is stored, wrong guesses are rate-limited, and staff can turn a call's links off at any time. A closed call takes nothing more.
