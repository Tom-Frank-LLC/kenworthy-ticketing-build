import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, RotateCcw, X, Copy } from 'lucide-react';
import { useColorLab } from './ColorLabProvider';
import {
  FIXED_SWATCHES,
  GREENS,
  PURPLES,
  SHIPPED_GREEN,
  SHIPPED_PURPLE,
  hexToHslToken,
  isHex,
  lum,
  makeCustom,
  pickForegroundHex,
  recommendation,
  type Swatch,
  type Tier,
} from '@/lib/colorLab';

/**
 * The floating Color Lab panel.
 *
 * The real site is the preview — that is the whole point of this version — so
 * unlike the standalone `public/colorlab.html` this carries no mock. It is a
 * control surface and a readout: pick a purple, pick a green, read the contrast,
 * and watch the actual page behind it change.
 *
 * The panel paints itself in **literal hex, not theme tokens.** If it used
 * `bg-card`/`text-foreground` it would re-tint along with the site, and a swatch
 * chosen badly enough would make the tool used to escape it unreadable. Fixed
 * colours are the one place in this codebase where that is correct.
 *
 * The custom picker is the browser's own `<input type="color">` rather than a
 * port of the standalone Lab's hand-built HSV square. Same capability, keyboard
 * accessible for free, and a fraction of the code to carry in a bundle that
 * ships to the public site.
 */

const INK = '#F4F1EB';
const INK_DIM = 'rgba(244,241,235,0.62)';
const SURFACE = '#141414';
const SURFACE_2 = '#1C1C1C';
const LINE = 'rgba(244,241,235,0.14)';

const TIER_STYLE: Record<Tier, { label: string; bg: string; fg: string }> = {
  pass: { label: 'PASS', bg: '#1F5132', fg: '#C6F6D5' },
  large: { label: 'LARGE ONLY', bg: '#5C4A12', fg: '#F6E6A8' },
  low: { label: 'LOW', bg: '#5C1F1F', fg: '#F6BCBC' },
};

/**
 * Two ratios, because the colour does two jobs and can pass one while failing
 * the other:
 *   "text"   — the colour ON the page background (links, headings, focus rings)
 *   "button" — text ON a filled control of this colour (Tickets, Sign In)
 * The 4.5:1 floor is the readability concern that started this exercise, so
 * both numbers are shown rather than averaged into one reassuring badge.
 */
function TierBadge({ swatch }: { swatch: Swatch }) {
  const row = (label: string, tier: Tier, c: number) => {
    const t = TIER_STYLE[tier];
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span style={{ color: INK_DIM }} className="text-[9px] uppercase">
          {label}
        </span>
        <span
          className="rounded px-1 py-px text-[9px] font-semibold tracking-wide"
          style={{ background: t.bg, color: t.fg }}
          title={`${c}:1 — ${t.label}`}
        >
          {c}:1
        </span>
      </span>
    );
  };
  return (
    <span className="flex items-center gap-2">
      {row('text', swatch.tier, swatch.c)}
      {row('button', swatch.tierInk, swatch.cInk)}
    </span>
  );
}

function Chip({
  swatch,
  selected,
  onPick,
}: {
  swatch: Swatch;
  selected: boolean;
  onPick: (hex: string) => void;
}) {
  // The same ink the site would lay on a button of this colour — so the chip is
  // a live sample of the decision, not an approximation of it.
  const fg = pickForegroundHex(swatch.hex);
  return (
    <button
      type="button"
      onClick={() => onPick(swatch.hex)}
      title={`${swatch.note} · ${swatch.c}:1 as text, ${swatch.cInk}:1 as a button · index.css token: ${swatch.hsl}`}
      aria-pressed={selected}
      className="relative rounded-md p-2 text-left transition-transform hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      style={{
        background: swatch.hex,
        color: fg,
        boxShadow: selected ? `0 0 0 2px ${INK}` : 'none',
      }}
    >
      {selected && (
        <span className="absolute right-1.5 top-1 text-[10px] leading-none" aria-hidden>
          ◆
        </span>
      )}
      <div className="text-[11px] font-semibold leading-tight">{swatch.name}</div>
      {/* The chip is itself a filled control in this colour, so the sample text
          sitting on it is the button-contrast number made visible. */}
      <div className="mt-0.5 flex items-baseline justify-between gap-1 text-[10px] opacity-80">
        <span>{swatch.hex}</span>
        <span>{swatch.cInk}:1</span>
      </div>
    </button>
  );
}

/** One adjustable colour: its presets, its custom picker, its readout. */
function Channel({
  label,
  presets,
  value,
  onPick,
}: {
  label: string;
  presets: Swatch[];
  value: string;
  onPick: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Follow the live value unless the field is mid-edit, so clicking a preset
  // updates the text box but typing into it is never fought.
  useEffect(() => setDraft(value), [value]);

  const current = useMemo(
    () => presets.find(p => p.hex.toLowerCase() === value.toLowerCase()) ?? makeCustom(value),
    [presets, value],
  );

  const commit = (hex: string) => {
    setDraft(hex);
    if (isHex(hex)) onPick(hex.toUpperCase());
  };

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: INK }}>
          {label}
        </h3>
        <TierBadge swatch={current} />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {presets.map(p => (
          <Chip
            key={p.hex}
            swatch={p}
            selected={p.hex.toLowerCase() === value.toLowerCase()}
            onPick={onPick}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={e => commit(e.target.value.toUpperCase())}
          aria-label={`${label} custom colour`}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={draft}
          spellCheck={false}
          aria-label={`${label} hex`}
          onChange={e => commit(e.target.value.trim())}
          className="h-8 w-full rounded px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-white/40"
          style={{ background: SURFACE_2, color: INK, border: `1px solid ${LINE}` }}
        />
      </div>
    </section>
  );
}

export default function ColorLabPanel() {
  const { purple, green, setPurple, setGreen, reset, close } = useColorLab();
  const [collapsed, setCollapsed] = useState(false);

  // With no override the Lab shows — and Reset returns to — exactly what
  // index.css ships, so opening the panel changes nothing on the page.
  const purpleHex = purple ?? SHIPPED_PURPLE;
  const greenHex = green ?? SHIPPED_GREEN;

  const purpleSwatch = useMemo(
    () => PURPLES.find(p => p.hex.toLowerCase() === purpleHex.toLowerCase()) ?? makeCustom(purpleHex),
    [purpleHex],
  );
  const greenSwatch = useMemo(
    () => GREENS.find(g => g.hex.toLowerCase() === greenHex.toLowerCase()) ?? makeCustom(greenHex),
    [greenHex],
  );

  // The exit from the brief: this is the text somebody pastes into index.css
  // when the decision is made, at which point the Lab gets switched off.
  const bakeText = [
    `--primary: ${hexToHslToken(purpleHex)};`,
    `--ring: ${hexToHslToken(purpleHex)};`,
    `--success: ${hexToHslToken(greenHex)};`,
  ].join('\n');

  const copyBake = async () => {
    try {
      await navigator.clipboard.writeText(bakeText);
      toast.success('index.css tokens copied');
    } catch {
      toast.error('Could not copy — the values are shown above.');
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-[100] flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold shadow-lg"
        style={{ background: SURFACE, color: INK, border: `1px solid ${LINE}` }}
      >
        <span className="h-3 w-3 rounded-full" style={{ background: purpleHex }} aria-hidden />
        <span className="h-3 w-3 rounded-full" style={{ background: greenHex }} aria-hidden />
        Color Lab
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex max-h-[82vh] w-[min(92vw,21rem)] flex-col overflow-hidden rounded-lg shadow-2xl"
      style={{ background: SURFACE, border: `1px solid ${LINE}`, color: INK }}
      role="dialog"
      aria-label="Color Lab"
    >
      <header
        className="flex shrink-0 items-center gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${LINE}` }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold">Color Lab</div>
          <div className="truncate text-[10px]" style={{ color: INK_DIM }}>
            This tab only · nothing is saved
          </div>
        </div>
        <button
          type="button"
          onClick={reset}
          title="Back to the shipped theme"
          className="rounded p-1.5 hover:bg-white/10"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="sr-only">Reset to shipped theme</span>
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Collapse"
          className="rounded p-1.5 hover:bg-white/10"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          <span className="sr-only">Collapse the panel</span>
        </button>
        <button
          type="button"
          onClick={close}
          title="Close the Lab for this session"
          className="rounded p-1.5 hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Close the Color Lab</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <Channel label="Purple · --primary" presets={PURPLES} value={purpleHex} onPick={setPurple} />
        <Channel label="Green · --success" presets={GREENS} value={greenHex} onPick={setGreen} />

        <section className="space-y-1.5">
          <h3
            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: INK }}
          >
            Fixed
          </h3>
          <div className="flex gap-1.5">
            {FIXED_SWATCHES.map(f => (
              <div
                key={f.token}
                className="flex-1 rounded px-1.5 py-2 text-center"
                style={{
                  background: f.hex,
                  color: lum(f.hex) > 0.4 ? '#0F0F0F' : '#F5F1E9',
                  border: `1px solid ${LINE}`,
                }}
                title={f.token}
              >
                <div className="text-[10px] font-semibold">{f.name}</div>
                <div className="text-[9px] opacity-75">{f.hex}</div>
              </div>
            ))}
          </div>
          <p className="text-[10px] leading-snug" style={{ color: INK_DIM }}>
            The Lab never touches these, nor the grey <code>--secondary</code> surface token.
          </p>
        </section>

        <p className="text-[11px] leading-snug" style={{ color: INK_DIM }}>
          {recommendation(purpleSwatch, greenSwatch)}
        </p>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3
              className="text-[11px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: INK }}
            >
              Bake into index.css
            </h3>
            <button
              type="button"
              onClick={copyBake}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] hover:bg-white/10"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
          <pre
            className="overflow-x-auto rounded p-2 font-mono text-[10px] leading-relaxed"
            style={{ background: SURFACE_2, color: INK, border: `1px solid ${LINE}` }}
          >
            {bakeText}
          </pre>
        </section>
      </div>
    </div>
  );
}
