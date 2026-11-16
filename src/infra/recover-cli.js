// npm run recover-owner [email]
//
// For an owner who is signed out everywhere and has lost their password. Prints a one-time link
// that sets a new one. Nothing is deleted: every account, call and customer stays as it is.
// It needs a shell on the machine that holds the database, which is what proves you may do this.
import { config } from './config.js';
import { openDatabase } from './db.js';
import { sqliteStore } from './documents-store.js';
import { createStaff } from '../../vendor/kit/staff/index.js';
import { ROLES } from '../domain/permissions.js';

export async function recoverOwner({ db, email = '', origin = '' }) {
  const store = sqliteStore(db);
  const staff = createStaff({ store, roles: ROLES, name: 'call-store', secure: config.production });
  if (staff.needsOwner()) return { ok: true, setup: true, link: `${origin}/staff/accept?token=${await staff.setup()}` };
  const owners = store.under('accounts').filter((a) => !a.disabled && a.roles?.includes('owner'));
  const wanted = email.trim().toLowerCase();
  const owner = wanted ? owners.find((a) => a.email === wanted) : owners.length === 1 ? owners[0] : null;
  if (!owner) return { error: wanted || !owners.length ? 'missing' : 'choose', owners: owners.map((a) => a.email) };
  // The kit lets an owner make a reset link for any account, their own included.
  const made = await staff.resetLink({ account: owner.key }, owner.key);
  if (made.error) return { error: made.error, owners: [] };
  return { ok: true, email: owner.email, link: `${origin}/staff/accept?token=${made.token}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDatabase(config.database);
  const origin = (process.env.PUBLIC_URL ?? `http://localhost:${config.port}`).replace(/\/$/, '');
  const r = await recoverOwner({ db, email: process.argv[2] ?? '', origin });
  db.close();
  if (r.ok) console.log(r.setup ? `Nobody has an account yet. Set up the first owner:\n${r.link}` : `Open this to choose a new password for ${r.email}. It works once and expires:\n${r.link}`);
  else if (r.error === 'choose') console.error(`There is more than one owner. Say which:\n${r.owners.map((e) => `  npm run recover-owner ${e}`).join('\n')}`);
  else if (r.error === 'missing') console.error(r.owners.length ? `No owner has that email. Owners: ${r.owners.join(', ')}` : 'No owner account is turned on.');
  else console.error(r.error);
  process.exitCode = r.ok ? 0 : 1;
}
