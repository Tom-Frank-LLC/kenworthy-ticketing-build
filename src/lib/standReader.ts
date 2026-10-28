import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { invokeFunction } from '@/lib/functions';

/**
 * The Square Stand the box-office iPad sits in, reached through the iOS app.
 *
 * A Square Terminal is driven from the server (square-terminal, Terminal API).
 * A Stand's reader is not reachable that way: only an app on the iPad it holds
 * can use it, through Square's Mobile Payments SDK. That SDK lives in the app's
 * own plugin (native/stand-reader), so on the website none of this exists and
 * `standAvailable()` is false.
 *
 * The sale itself keeps the counter's order of events: rows first (pending),
 * then the reader, then confirm. The server sets the amount, creates the
 * Square Order and names the reference (`start_sale` with `reader: 'stand'`);
 * this takes the card for exactly that; the server reads the payment back from
 * Square before it confirms anything (`confirm_sale` with `payment_id`).
 *
 * See docs/briefs/BRIEF-ios-stand-reader.md.
 */

/**
 * The picker's id for "the Stand this iPad is in": the till itself sits in the
 * Stand. The alternative setup, for a special event with no patron-facing
 * display. Not a Square device id.
 */
export const STAND_READER_ID = 'stand';

/**
 * The picker's id for "the Stand at the patron-facing display": the usual
 * setup (BRIEF-stand-at-patron-display.md). The till can be any device; the
 * card is taken by the iOS app on the display iPad, paired to this station.
 */
export const DISPLAY_STAND_READER_ID = 'display-stand';

export interface StandReaderInfo {
  id: number;
  name: string;
  serialNumber: string | null;
  model: 'stand' | 'contactless_and_chip' | 'magstripe' | 'tap_to_pay' | 'unknown';
  status: 'ready' | 'connecting_to_device' | 'connecting_to_square' | 'faulty' | 'unavailable';
  embedded: boolean;
}

export interface StandStatus {
  available: boolean;
  environment?: 'production' | 'sandbox';
  sdkVersion?: string;
  authorized?: boolean;
  locationId?: string | null;
  locationName?: string | null;
  location?: 'granted' | 'denied' | 'prompt';
  readers?: StandReaderInfo[];
}

export interface StandPayment {
  id: string | null;
  amountCents: number;
  totalCents: number;
  referenceId: string | null;
  orderId: string | null;
  locationId: string | null;
  online: boolean;
  paymentStatus?: string;
  last4?: string | null;
}

export interface StandPaymentResult {
  status: 'finished' | 'failed' | 'canceled';
  payment?: StandPayment;
  errorCode?: string;
  errorMessage?: string;
}

interface StandReaderPlugin {
  getStatus(): Promise<StandStatus>;
  requestPermissions(): Promise<{ location: string }>;
  authorize(options: { accessToken: string; locationId: string }): Promise<{ authorized: boolean }>;
  deauthorize(): Promise<void>;
  startPayment(options: {
    amountCents: number;
    paymentAttemptId: string;
    referenceId: string;
    orderId?: string | null;
    note?: string;
  }): Promise<StandPaymentResult>;
  cancelPayment(): Promise<{ canceled: boolean }>;
  showSettings(): Promise<void>;
  showMockReader(): Promise<void>;
  hideMockReader(): Promise<void>;
  addListener(event: 'readersChanged', cb: (e: { reader: StandReaderInfo; change: string }) => void): Promise<PluginListenerHandle>;
}

export const StandReader = registerPlugin<StandReaderPlugin>('StandReader');

/** True only inside the iOS app, where the plugin is compiled in. */
export function standAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('StandReader');
}

/** The Stand itself, among whatever readers the SDK can see. */
export function standOf(status: StandStatus | null): StandReaderInfo | null {
  return status?.readers?.find((r) => r.model === 'stand' || r.embedded) ?? null;
}

/** One line for the picker: what the counter needs to know about the Stand. */
export function describeStand(status: StandStatus | null): string {
  if (!status) return 'checking…';
  if (!status.available) return 'not set up in this build';
  if (!status.authorized) return 'not signed in to Square';
  if (status.location === 'denied') return 'needs Location permission (Settings → Kenworthy)';
  const stand = standOf(status);
  if (!stand) {
    return status.environment === 'sandbox' && (status.readers?.length ?? 0) > 0 ? 'mock reader' : 'not detected — is the iPad docked?';
  }
  switch (stand.status) {
    case 'ready': return 'ready';
    case 'connecting_to_device':
    case 'connecting_to_square': return 'connecting…';
    case 'faulty': return 'faulty — contact Square';
    default: return 'unavailable';
  }
}

/**
 * Sign the SDK in to Square for this location, if it is not already.
 *
 * The token comes from `square-mobile` (staff only): in production the
 * theatre's OAuth token, which Square requires for the SDK; in the sandbox the
 * sandbox token. The SDK keeps its own session afterwards, so this is a no-op
 * on every sale but the first after launch, and the token is fetched only
 * when the SDK has no session.
 */
export async function ensureStandAuthorized(): Promise<StandStatus> {
  let status = await StandReader.getStatus();
  if (!status.available) throw new Error('This build of the app cannot use the Square Stand.');
  if (status.location !== 'granted') {
    await StandReader.requestPermissions();
  }
  if (!status.authorized) {
    const auth = await invokeFunction<{ access_token: string; location_id: string }>('square-mobile', { action: 'token' });
    await StandReader.authorize({ accessToken: auth.access_token, locationId: auth.location_id });
    status = await StandReader.getStatus();
  }
  return status;
}

/**
 * Take the card on the Stand for a sale `start_sale` has set up.
 *
 * `paymentAttemptId` is Square's idempotency for the attempt: a retry with the
 * same id cannot charge twice, so the caller keeps one per sale.
 */
export async function takeStandPayment(sale: {
  amountCents: number;
  referenceId: string;
  orderId: string | null;
  paymentAttemptId: string;
  note: string;
}): Promise<StandPaymentResult> {
  return StandReader.startPayment({
    amountCents: sale.amountCents,
    paymentAttemptId: sale.paymentAttemptId,
    referenceId: sale.referenceId,
    orderId: sale.orderId,
    note: sale.note,
  });
}

/**
 * A sentence for the counter when the Stand did not take a payment.
 *
 * Square's own messages are written for developers ("Something went wrong.
 * Please contact the developer of this application and provide them with this
 * error code: payment_timed_out"), so the common codes are said plainly and
 * anything else keeps Square's code for whoever is asked about it.
 */
export function standFailureMessage(result: Pick<StandPaymentResult, 'errorCode' | 'errorMessage'>): string {
  const raw = `${result.errorCode ?? ''} ${result.errorMessage ?? ''}`;
  if (/timed_out|timedOut|TimedOut/i.test(raw)) return 'The Stand timed out waiting for a card. Ring the sale again when the patron is ready.';
  if (/no_?network|NoNetwork|not connected to the internet/i.test(raw)) return 'The iPad is offline, so the Stand cannot take cards. Check the Wi-Fi, or take cash.';
  if (/location/i.test(raw)) return 'Square needs Location permission to take cards: Settings → Kenworthy → Location → While Using.';
  if (/not_?authorized|NotAuthorized/i.test(raw)) return 'The Stand is not signed in to Square. Tap the refresh button by "Card reader", then try again.';
  const code = raw.match(/error code: ([a-z_]+)/i)?.[1] ?? result.errorCode;
  return code ? `The Stand did not take the payment (Square: ${code}).` : 'The Stand did not take the payment.';
}
