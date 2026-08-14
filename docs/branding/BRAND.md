# Kenworthy Performing Arts Centre — Brand Guidelines

> Digital brand system for the Kenworthy ticketing platform. This is the source of truth for typography, color, and component styling. All values are drawn directly from the live design tokens in the codebase (`src/index.css`, `tailwind.config.ts`).
>
> **Design story:** The palette is pulled from the building itself — the near-black of a darkened auditorium, the **magenta of the neon marquee tubing**, the **gold of the "Celebrating 100 Years" accents**, and the warm cream of a paper program. Nothing here is a neutral gray: a warm hue (≈38°) runs through every "white" and "gray" in the system, which is what makes the whole palette feel cohesive and analog rather than cold and digital.

---

## 1. Typography

Three typefaces, each with a distinct role. All loaded from Google Fonts.

### Anton — Display / Headlines
- **Use:** All headlines (h1–h6), the logo wordmark, marquee-style titles.
- **Character:** Tall, condensed, high-impact. Evokes theatre marquee lettering.
- **Always:** UPPERCASE, letter-spacing `0.01em`.
- **Weight:** 400 (Anton ships in a single weight).
- **Fallbacks:** Bebas Neue, Impact, sans-serif.

### Fraunces — Body & Editorial
- **Use:** All body copy, intro/lede text, italic editorial notes, eyebrow labels, button/UI text.
- **Character:** A warm, literary serif with optical sizing. Feels like printed program text.
- **Weight:** 400 (Regular) for body. *It is never "thin"* — the light impression comes from delicate serifs + muted color + antialiasing, not a low font-weight.
- **Optical sizing:** auto.
- **Fallbacks:** Georgia, serif.

### Inter — Interface / Utility
- **Use:** Small functional UI where the serif would be too decorative (dense controls, data).
- **Weight:** 300–700 available.
- **Fallbacks:** system-ui, sans-serif.

### Type Specs

**Body (default)**
Fraunces · 400 · 17px · line-height 1.6 · color `foreground` (warm cream `#F5F1E9`).

**Body (secondary / supporting)**
Fraunces · 400 · color `muted-foreground` (warm gray `#ABA69C`). Used for supporting lines, captions, dimmed context.

**Section Eyebrow / Kicker** (e.g. "A NOTE FROM THE BOOTH", "FEATURED")
Fraunces · UPPERCASE · gold `accent` (`#D6A94A`) · letter-spacing **0.3em** · **12px** · weight 400 · margin-bottom 12px.
- *Canonical spec:* **12px / 0.3em tracking.**
- *Smaller step* (above card-level headlines): 11px / 0.25em.
- ⚠️ **Consistency note:** the current build has minor drift (tracking appears at 0.3em, 0.25em, and 0.2em; sizes 10–12px). Codify to **two steps only** — 12px/0.3em and 11px/0.25em — and retire the rest.

**Headline (display)**
Anton · UPPERCASE · letter-spacing 0.01em · line-height 0.95–1.1 · sizes scale from `text-xl` up to `text-5xl` by context.

---

## 2. Color

All colors are defined as HSL design tokens. Hex values are conversions (accurate to rounding) — **the HSL triples are the true source of truth.**

### Core Palette

| Token | Role | HSL | Hex |
|---|---|---|---|
| `background` | Page black (darkened auditorium) | `0 0% 6%` | `#0F0F0F` |
| `foreground` | Primary text — warm cream | `38 30% 94%` | `#F5F1E9` |
| `primary` | **Magenta — neon marquee tubing.** Primary actions (Donate, active buttons) | `333 78% 52%` | `#E42D8C` |
| `accent` | **Gold — "100 Years" accents, nav links, dividers** | `41 65% 56%` | `#D6A94A` |
| `muted-foreground` | Secondary/dimmed text — warm gray | `38 10% 65%` | `#ABA69C` |

### Surfaces

| Token | Role | HSL | Hex |
|---|---|---|---|
| `card` / `popover` | Lifted panels above the page black | `0 0% 9%` | `#171717` |
| `secondary` / `muted` | Dark gray fills | `0 0% 14%` | `#242424` |
| `paper` | Paper-program cream (light-variant editorial surface) | `38 30% 92%` | `#F1EBDF` |
| `border` / `input` | Subtle outlines | `0 0% 16%` | `#292929` |

### Functional

| Token | Role | HSL | Hex |
|---|---|---|---|
| `primary-foreground` | Text on magenta | `38 30% 96%` | `#F9F6F0` |
| `accent-foreground` | Text on gold | `0 0% 6%` | `#0F0F0F` |
| `destructive` | Errors | `0 72% 51%` | `#DC2626` |
| `ring` | Focus ring (matches magenta) | `333 78% 52%` | `#E42D8C` |

### The Warm-Axis Principle
Every off-white and gray in the system shares the **~38° warm hue**. `foreground`, `muted-foreground`, `paper`, and the button-foregrounds all sit on this axis. **Never use pure white (`#FFFFFF`) or neutral grays** — they read as cold and break the analog, paper-and-neon feel. When adding a new tint, keep hue near 38° for creams/grays.

### The Two Brand Colors
The identity rests on two signatures against near-black:
- **Magenta `#E42D8C`** — energy, calls-to-action, the "live" neon.
- **Gold `#D6A94A`** — heritage, navigation, structure, the century of history.
Use them deliberately: magenta = *act*, gold = *navigate / honor the history*. Avoid using them interchangeably.

---

## 3. Components

### Buttons
- **Shape:** `rounded-md` (radius `0.5rem` / 8px base token).
- **Text:** Fraunces, 14px (`text-sm`), medium weight.
- **Sizes:** default 40px tall (`h-10`, px-16) · small 36px · large 44px (px-32) · icon 40×40.
- **Variants:**
  - **default (primary):** magenta bg, cream text, hover darkens to 90%.
  - **outline:** transparent bg + border; on hover fills **gold** with dark text.
  - **secondary:** dark gray bg (`#242424`), cream text.
  - **ghost:** transparent; hover fills gold.
  - **destructive:** red bg.
- **Focus:** 2px magenta ring, offset 2px.

### Badges
- Small pill labels (e.g. `RSVP`). Outline variant at 10px is used for micro-labels.

### Dividers / Accents
- Thin gold (`accent`) rules and dot markers separate editorial sections (see the horizontal line under the "What We're Watching" intro).

### Radius
- Base `--radius: 0.5rem` (8px). Some inner elements use 4px.

---

## 4. Quick Reference (for design tools)

```
FONTS
  Display:  Anton (uppercase, +0.01em)
  Body:     Fraunces (400, 17px, 1.6)
  UI:       Inter

COLORS (hex)
  Black bg      #0F0F0F
  Cream text    #F5F1E9
  Muted text    #ABA69C
  Magenta       #E42D8C   ← primary action
  Gold          #D6A94A   ← accent / nav / heritage
  Panel         #171717
  Fill gray     #242424
  Cream (paper) #F1EBDF
  Border        #292929
  Error red     #DC2626

EYEBROW LABEL
  Fraunces · UPPERCASE · gold #D6A94A · 12px · tracking 0.3em
```

---

*Generated from the live design tokens. If tokens change in `src/index.css`, update this document to match — or better, treat the tokens as source and regenerate.*
