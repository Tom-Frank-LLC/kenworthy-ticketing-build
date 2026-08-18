// Who may resend a ticket confirmation, and to whom.
//
// Extracted from send-ticket-confirmation so the one decision that can misroute
// a patron's ticket is testable without standing up a function. The HTTP
// plumbing stays in the function; this is the rule.

/** A caller's privilege class, once identity has been established. */
export interface CallerClass {
  /** The service role, or another edge function calling in. */
  isServiceRole: boolean;
  /** A signed-in user holding `staff` (which admin and superadmin satisfy). */
  isStaff: boolean;
}

/**
 * Operators may deliver *any* order and may redirect it.
 *
 * Staff are operators because the box office cannot work otherwise: StaffPOS
 * writes ticket rows owned by the staff member who rang the sale, and the
 * patron's address is typed at the counter and stored on no profile. Delivery
 * that ignores the override goes to the staff member.
 */
export function isOperator(caller: CallerClass): boolean {
  return caller.isServiceRole || caller.isStaff;
}

/** The recipient fields, as a request body carries them. */
export interface OverrideBody {
  email?: unknown;
  phone?: unknown;
  name?: unknown;
}

/**
 * Read the recipient overrides a caller is allowed to set.
 *
 * A non-operator gets empty strings, not the values they sent: `deliver.ts`
 * treats an empty override as "fall back to the order's own account", which is
 * the only recipient a patron resending their own confirmation may reach.
 */
export function overridesFor(
  caller: CallerClass,
  body: OverrideBody,
): { email: string; phone: string; name: string } {
  if (!isOperator(caller)) return { email: '', phone: '', name: '' };
  return {
    email: String(body.email || ''),
    phone: String(body.phone || ''),
    name: String(body.name || ''),
  };
}
