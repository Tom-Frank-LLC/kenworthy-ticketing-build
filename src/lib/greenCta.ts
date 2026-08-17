/**
 * The green call-to-action.
 *
 * Purple (`--primary`) is the site's *general* highlighter — links, focus
 * rings, most buttons. Green is meant to be the opposite: rare and deliberate,
 * so that the one action a visitor is most likely to want reads as different in
 * kind from everything around it rather than merely louder. In the header that
 * is literal — Tickets sits directly beside Donate, and if both are purple the
 * pair is a colour with two meanings.
 *
 * Green lives in the existing `--success` token. **Not** in the CSS token
 * literally named `--secondary`: despite the brand calling green the secondary
 * colour, `--secondary` is a dark grey used for secondary button and surface
 * backgrounds all over the site, and painting it green would splash green
 * everywhere — the exact opposite of what scarcity is for. The brand word and
 * the CSS token collide; the token wins.
 *
 * Every green CTA on the site is listed here, and they are green *only* by
 * referencing this constant:
 *
 *   1. `Layout.tsx`               — "Tickets", the header nav CTA
 *   2. `home/ShowingPreview.tsx`  — "Get Tickets"
 *   3. `home/EditorialCalendar.tsx` — "Get Tickets"
 *   4. `home/TrailerFeed.tsx`     — "Get Tickets"
 *
 * That is the whole set. Keeping it in one constant is what makes the choice
 * auditable — and, if the team decides against it, revertible in one edit.
 *
 * Because these reference the token rather than a literal, the Color Lab's
 * green control recolours all four live. See `src/lib/colorLab.ts`.
 */
export const GREEN_CTA = 'bg-success text-success-foreground hover:bg-success/90';
