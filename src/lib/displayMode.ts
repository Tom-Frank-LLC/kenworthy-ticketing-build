/**
 * "This iPad is the patron-facing display" — a property of the device, for the
 * iOS app on the iPad in the Square Stand (BRIEF-stand-at-patron-display.md).
 *
 * The app has no address bar, and iOS relaunches it at the home page after it
 * has been closed or updated. So the display remembers that it is one, the app
 * reopens on it, and the display's staff panel is the way out. Kept in
 * localStorage beside the display's pairing code; a cleared store just means
 * staff open the display again from the Staff page.
 */
const KEY = 'kenworthy.app.displayMode';
export const DISPLAY_PATH = '/pos/display';

export function rememberDisplayMode(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* staff open it again from the Staff page */ }
}

export function inDisplayMode(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
