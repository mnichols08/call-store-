// Who may do what. The matrix is in docs/authorization.md; this is the same table as code.
//
// Roles come from the signed-in account (kit/staff). An owner can do everything. A manager can do
// what staff can, plus manage the catalog and see the reports. Staff work calls and customers.

export const ROLES = Object.freeze(['owner', 'manager', 'staff']);

const STAFF = ['call.view', 'call.create', 'call.edit', 'call.claim', 'call.release', 'call.move', 'call.help', 'call.close', 'call.reopen',
  'customer.view', 'customer.create', 'customer.edit', 'item.view', 'item.create', 'nudge.send',
  'vehicle.lookup', 'vehicle.save', 'parts.find', 'parts.feedback', 'parts.teach', 'call.watch', 'call.suggest', 'portal.invite', 'portal.update'];
const MANAGER = [...STAFF, 'call.assign', 'item.edit', 'customer.deactivate', 'report.view', 'audit.view', 'parts.manage', 'watch.manage', 'portal.manage', 'hours.manage'];

const GRANTS = Object.freeze({ staff: new Set(STAFF), manager: new Set(MANAGER) });

/** Whether a signed-in person (`{ roles }`) holds a permission. Nobody signed in holds none. */
export function can(who, permission) {
  if (!who?.roles) return false;
  if (who.roles.includes('owner')) return true;
  return who.roles.some((role) => GRANTS[role]?.has(permission));
}

export const PERMISSIONS = Object.freeze([...new Set([...MANAGER])]);
