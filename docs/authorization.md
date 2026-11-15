# Authorization

Identity is the signed-in account (`kit/staff`); every action is attributed to that person's email, not to a workstation. The matrix below is `src/domain/permissions.js`, and the tests walk it. The checks live in `src/app`, so no page can skip them.

| Permission | Staff | Manager | Owner |
| --- | :-: | :-: | :-: |
| See and search calls, customers, items | ✓ | ✓ | ✓ |
| Start, edit, claim, park, resume, ask for help, finish, reopen a call | ✓ | ✓ | ✓ |
| Add and edit customers, add contacts | ✓ | ✓ | ✓ |
| Add an item | ✓ | ✓ | ✓ |
| Hand a call back that someone else holds, assign calls | | ✓ | ✓ |
| Edit or retire an item | | ✓ | ✓ |
| Mark a customer inactive | | ✓ | ✓ |
| Reports, CSV, activity log | | ✓ | ✓ |
| Invite people, set roles, reset passwords, turn accounts off | | | ✓ |

Rules that go with it:

- Nobody signed in can do anything; every page except sign-in and `/healthz` redirects to sign-in.
- Posts must come from this site (`Origin`, or `Sec-Fetch-Site` where a page sends `Origin: null`).
- Messages after a form are signed, so a crafted link can't put words in an alert box.
- Everything a person types is escaped on the way out. The page's Content-Security-Policy allows scripts only from this site and from Zubra's own, by nonce.
- A coworker's newer edit to a call is never overwritten: saves carry the revision they started from and a stale one is refused.
