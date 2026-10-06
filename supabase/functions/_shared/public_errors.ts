// What an anonymous caller is told when something goes wrong on a public money
// path — and, by omission, what they are not.
//
// The rule (audit L10, 2026-10-06): a public response carries a sentence the
// patron can act on, never a provider's or library's own text. GoTrue's
// createUser errors, a raw exception's `.message`, Square's `detail` strings and
// the names of unset environment variables all used to reach the browser. None
// of it was secret, but all of it described our internals to whoever asked,
// and none of it helped the person at the keyboard. The detail goes to the log;
// the patron gets one of these.

/** The box office line, for every "call us" in this file. */
export const BOX_OFFICE_PHONE = '208-882-4127';

/**
 * Something on our side failed before any money moved. Only used where that is
 * true — the sentence makes a promise about the card.
 */
export const NOT_CHARGED_FAILURE =
  `Something went wrong on our side and your card was not charged. Please try again, or call the box office on ${BOX_OFFICE_PHONE}.`;

/** Square is not configured on this deployment — a config fault, not the patron's. */
export const PAYMENTS_UNAVAILABLE =
  `Online payments are not available right now. Please call the box office on ${BOX_OFFICE_PHONE}.`;

/**
 * A decline, in words a patron can act on.
 *
 * Square's own text is `errors[0].detail`, which for a card error reads like
 * "Authorization error: 'CVV_FAILURE'" — accurate, and written for a developer.
 * The code is what we map on. Three outcomes are worth distinguishing because
 * the patron can fix them by retyping (security code, postcode, expiry); every
 * other decline gets the same sentence. Saying *why* a bank refused —
 * insufficient funds, suspected fraud, a blocked card — helps nobody honest
 * and tells a card tester which stolen numbers are live.
 */
export function publicDeclineMessage(data: any): string {
  const first = data?.errors?.[0] ?? {};
  const code = String(first.code ?? '');
  const category = String(first.category ?? '');

  // The single-use card token was spent or went stale — re-entering the card
  // mints a new one. Not the patron's card at all.
  if (code === 'CARD_TOKEN_USED' || code === 'CARD_TOKEN_EXPIRED') {
    return 'Your card details expired before the payment went through. Please re-enter your card and try again.';
  }

  // Square refused the request rather than the bank refusing the card: our
  // credentials, our request, a Square outage. "Declined" would send the patron
  // to their bank about a fault that is ours.
  if (category && category !== 'PAYMENT_METHOD_ERROR') {
    return `We could not process this payment and your card was not charged. Please try again, or call the box office on ${BOX_OFFICE_PHONE}.`;
  }

  switch (code) {
    case 'CVV_FAILURE':
    case 'VERIFY_CVV_FAILURE':
      return "The card's security code didn't match. Please check it and try again.";
    case 'ADDRESS_VERIFICATION_FAILURE':
    case 'VERIFY_AVS_FAILURE':
    case 'INVALID_POSTAL_CODE':
      return "The postal code didn't match the card. Please check it and try again.";
    case 'INVALID_EXPIRATION':
    case 'INVALID_EXPIRATION_DATE':
    case 'INVALID_EXPIRATION_YEAR':
    case 'EXPIRATION_FAILURE':
    case 'CARD_EXPIRED':
      return "The card's expiry date was not accepted. Please check it, or use another card.";
    default:
      return 'Your card was declined. Please try another card, or contact your bank.';
  }
}
