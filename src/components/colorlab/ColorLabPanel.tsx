import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, RotateCcw, X, Copy, Star, Globe, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useColorLab } from './ColorLabProvider';
import {
  FIXED_SWATCHES,
  GREENS,
  PURPLES,
  SHIPPED_GREEN,
  SHIPPED_PURPLE,
  forgetSwatch,
  hexToHslToken,
  isHex,
  lum,
  makeCustom,
  pickForegroundHex,
  readSaved,
  recommendation,
  saveSwatch,
  savedSwatch,
  type Channel,
  type Swatch,
  type Tier,
} from '@/lib/colorLab';
import { isEmpty, publishSiteTheme, revertSiteTheme } from '@/lib/siteTheme';

/**
 * The floating Color Lab panel.
 *
 * The real site is the preview — that is the point of this version — so unlike
 * the standalone `public/colorlab.html` it carries no mock. It is a control
 * surface and a readout: pick a purple, pick a green, read the contrast, and
 * watch the actual page behind it change.
 *
 * The panel paints itself in **literal hex, not theme tokens.** If it used
 * `bg-card`/`text-foreground` it would re-tint along with the site, and a swatch
 * chosen badly enough would make the tool used to escape it unreadable. Fixed
 * colours are the one place in this codebase where that is correct.
 *
 * Type is sized in px for the same reason — the panel is a instrument sitting
 * on top of the thing it measures, and it should not resize when the site's
 * typography is being judged.
 */

const INK = '#F4F1EB';
const INK_DIM = 'rgba(244,241,235,0.66)';
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
        <span style={{ color: INK_DIM, fontSize: 11 }} className="uppercase tracking-wide">
          {label}
        </span>
        <span
          className="rounded px-1.5 py-0.5 font-semibold"
          style={{ background: t.bg, color: t.fg, fontSize: 12 }}
          title={`${c}:1 — ${t.label}`}
        >
          {c}:1
        </span>
      </span>
    );
  };
  return (
    <span className="flex items-center gap-2.5">
      {row('text', swatch.tier, swatch.c)}
      {row('button', swatch.tierInk, swatch.cInk)}
    </span>
  );
}

function Chip({
  swatch,
  selected,
  onPick,
  onForget,
}: {
  swatch: Swatch;
  selected: boolean;
  onPick: (hex: string) => void;
  onForget?: () => void;
}) {
  // The same ink the site would lay on a button of this colour — so the chip is
  // a live sample of the decision, not an approximation of it.
  const fg = pickForegroundHex(swatch.hex);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onPick(swatch.hex)}
        title={`${swatch.note} · ${swatch.c}:1 as text, ${swatch.cInk}:1 as a button · index.css token: ${swatch.hsl}`}
        aria-pressed={selected}
        className="w-full rounded-md p-2.5 text-left transition-transform hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        style={{
          background: swatch.hex,
          color: fg,
          boxShadow: selected ? `0 0 0 2px ${INK}` : 'none',
        }}
      >
        {selected && (
          <span className="absolute right-2 top-1.5 leading-none" style={{ fontSize: 12 }} aria-hidden>
            ◆
          </span>
        )}
        <div className="font-semibold leading-tight" style={{ fontSize: 14 }}>
          {swatch.name}
        </div>
        {/* The chip is itself a filled control in this colour, so the sample
            text sitting on it is the button-contrast number made visible. */}
        <div className="mt-1 flex items-baseline justify-between gap-1 opacity-85" style={{ fontSize: 12.5 }}>
          <span>{swatch.hex}</span>
          <span>{swatch.cInk}:1</span>
        </div>
      </button>
      {onForget && (
        <button
          type="button"
          onClick={onForget}
          title={`Forget ${swatch.hex}`}
          className="absolute -right-1.5 -top-1.5 rounded-full p-1 shadow"
          style={{ background: SURFACE_2, color: INK, border: `1px solid ${LINE}` }}
        >
          <Trash2 style={{ height: 11, width: 11 }} />
          <span className="sr-only">Forget this saved colour</span>
        </button>
      )}
    </div>
  );
}

/** One adjustable colour: its presets, its saved picks, its custom picker. */
function ChannelSection({
  channel,
  label,
  presets,
  value,
  onPick,
  saved,
  onSavedChange,
}: {
  channel: Channel;
  label: string;
  presets: Swatch[];
  value: string;
  onPick: (hex: string) => void;
  saved: string[];
  onSavedChange: () => void;
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

  const alreadySaved = saved.includes(value.toUpperCase());
  const isPreset = presets.some(p => p.hex.toLowerCase() === value.toLowerCase());

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h3 className="font-semibold uppercase tracking-[0.16em]" style={{ color: INK, fontSize: 13 }}>
          {label}
        </h3>
        <TierBadge swatch={current} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {presets.map(p => (
          <Chip
            key={p.hex}
            swatch={p}
            selected={p.hex.toLowerCase() === value.toLowerCase()}
            onPick={onPick}
          />
        ))}
      </div>

      {saved.length > 0 && (
        <>
          <p className="uppercase tracking-[0.16em]" style={{ color: INK_DIM, fontSize: 11 }}>
            Saved
          </p>
          <div className="grid grid-cols-2 gap-2">
            {saved.map(hex => (
              <Chip
                key={hex}
                swatch={savedSwatch(hex)}
                selected={hex.toLowerCase() === value.toLowerCase()}
                onPick={onPick}
                onForget={() => {
                  forgetSwatch(channel, hex);
                  onSavedChange();
                }}
              />
            ))}
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={e => commit(e.target.value.toUpperCase())}
          aria-label={`${label} custom colour`}
          className="h-9 w-11 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={draft}
          spellCheck={false}
          aria-label={`${label} hex`}
          onChange={e => commit(e.target.value.trim())}
          className="h-9 w-full rounded px-2 font-mono outline-none focus:ring-1 focus:ring-white/40"
          style={{ background: SURFACE_2, color: INK, border: `1px solid ${LINE}`, fontSize: 13.5 }}
        />
        <button
          type="button"
          disabled={alreadySaved || isPreset}
          title={
            isPreset
              ? 'Already a preset'
              : alreadySaved
                ? 'Already saved'
                : `Save ${value} to this browser`
          }
          onClick={() => {
            saveSwatch(channel, value);
            onSavedChange();
            toast.success(`Saved ${value.toUpperCase()}`);
          }}
          className="flex h-9 shrink-0 items-center gap-1 rounded px-2.5 disabled:opacity-35"
          style={{ background: SURFACE_2, color: INK, border: `1px solid ${LINE}`, fontSize: 13 }}
        >
          <Star style={{ height: 13, width: 13 }} /> Save
        </button>
      </div>
    </section>
  );
}

/**
 * Publishing to the live site. Superadmins only — and the database is what
 * enforces that, not this component; the RLS policies on `app_config` refuse
 * the write regardless of what the UI chooses to draw.
 */
function PublishSection({
  purpleHex,
  greenHex,
  publishedLabel,
  onDone,
}: {
  purpleHex: string;
  greenHex: string;
  publishedLabel: string;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState<null | 'publish' | 'revert'>(null);
  const [busy, setBusy] = useState(false);

  const run = async (what: 'publish' | 'revert') => {
    setBusy(true);
    try {
      if (what === 'publish') await publishSiteTheme({ purple: purpleHex, green: greenHex });
      else await revertSiteTheme();
      toast.success(
        what === 'publish' ? 'Published — every visitor sees these colours' : 'Site reverted to the code defaults',
      );
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The write was refused.');
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const btn = {
    background: SURFACE_2,
    color: INK,
    border: `1px solid ${LINE}`,
    fontSize: 13,
  } as const;

  return (
    <section className="space-y-2" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
      <h3 className="font-semibold uppercase tracking-[0.16em]" style={{ color: INK, fontSize: 13 }}>
        <Globe className="mr-1 inline" style={{ height: 13, width: 13 }} /> Publish to the live site
      </h3>
      <p style={{ color: INK_DIM, fontSize: 12.5 }} className="leading-snug">
        Currently published: <b style={{ color: INK }}>{publishedLabel}</b>. Publishing replaces it
        for <b style={{ color: INK }}>every visitor</b>, not just this tab.
      </p>

      {confirming === null ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfirming('publish')}
            className="rounded px-2.5 py-1.5"
            style={btn}
          >
            Publish {purpleHex} + {greenHex}
          </button>
          <button
            type="button"
            onClick={() => setConfirming('revert')}
            className="rounded px-2.5 py-1.5"
            style={btn}
          >
            Revert site to code defaults
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ fontSize: 12.5 }}>
            {confirming === 'publish'
              ? 'Publish these colours to everyone?'
              : 'Remove the published theme for everyone?'}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(confirming)}
            className="rounded px-2.5 py-1.5 font-semibold disabled:opacity-50"
            style={{ ...btn, background: '#1F5132', color: '#C6F6D5' }}
          >
            {busy ? 'Working…' : 'Yes, do it'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(null)}
            className="rounded px-2.5 py-1.5"
            style={btn}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

export default function ColorLabPanel() {
  const { purple, green, published, setPurple, setGreen, reset, close } = useColorLab();
  const { isSuperadmin } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [saved, setSaved] = useState(() => readSaved());
  const refreshSaved = () => setSaved(readSaved());

  // What this tab is showing: its own override, else what is published to the
  // site, else what index.css ships.
  const purpleHex = purple ?? published.purple ?? SHIPPED_PURPLE;
  const greenHex = green ?? published.green ?? SHIPPED_GREEN;

  const purpleSwatch = useMemo(
    () => PURPLES.find(p => p.hex.toLowerCase() === purpleHex.toLowerCase()) ?? makeCustom(purpleHex),
    [purpleHex],
  );
  const greenSwatch = useMemo(
    () => GREENS.find(g => g.hex.toLowerCase() === greenHex.toLowerCase()) ?? makeCustom(greenHex),
    [greenHex],
  );

  // The other exit: paste these into index.css and switch the Lab off. Still
  // here alongside Publish, because baking the decision into code is the
  // durable answer and a published row is the reversible one.
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
        className="fixed bottom-4 right-4 z-[100] flex items-center gap-2 rounded-full px-3.5 py-2.5 font-semibold shadow-lg"
        style={{ background: SURFACE, color: INK, border: `1px solid ${LINE}`, fontSize: 13.5 }}
      >
        <span className="h-3.5 w-3.5 rounded-full" style={{ background: purpleHex }} aria-hidden />
        <span className="h-3.5 w-3.5 rounded-full" style={{ background: greenHex }} aria-hidden />
        Color Lab
        <ChevronUp style={{ height: 15, width: 15 }} />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex max-h-[84vh] w-[min(94vw,24rem)] flex-col overflow-hidden rounded-lg shadow-2xl"
      style={{ background: SURFACE, border: `1px solid ${LINE}`, color: INK, fontSize: 14 }}
      role="dialog"
      aria-label="Color Lab"
    >
      <header
        className="flex shrink-0 items-center gap-2 px-3.5 py-2.5"
        style={{ borderBottom: `1px solid ${LINE}` }}
      >
        <div className="min-w-0 flex-1">
          <div className="font-semibold" style={{ fontSize: 15 }}>
            Color Lab
          </div>
          <div className="truncate" style={{ color: INK_DIM, fontSize: 12 }}>
            This tab only, until you publish
          </div>
        </div>
        <button type="button" onClick={reset} title="Back to the published theme" className="rounded p-2 hover:bg-white/10">
          <RotateCcw style={{ height: 15, width: 15 }} />
          <span className="sr-only">Reset this tab</span>
        </button>
        <button type="button" onClick={() => setCollapsed(true)} title="Collapse" className="rounded p-2 hover:bg-white/10">
          <ChevronDown style={{ height: 15, width: 15 }} />
          <span className="sr-only">Collapse the panel</span>
        </button>
        <button type="button" onClick={close} title="Close the Lab for this session" className="rounded p-2 hover:bg-white/10">
          <X style={{ height: 15, width: 15 }} />
          <span className="sr-only">Close the Color Lab</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3.5">
        <ChannelSection
          channel="purple"
          label="Purple · --primary"
          presets={PURPLES}
          value={purpleHex}
          onPick={setPurple}
          saved={saved.purple}
          onSavedChange={refreshSaved}
        />
        <ChannelSection
          channel="green"
          label="Green · --success"
          presets={GREENS}
          value={greenHex}
          onPick={setGreen}
          saved={saved.green}
          onSavedChange={refreshSaved}
        />

        <section className="space-y-2">
          <h3 className="font-semibold uppercase tracking-[0.16em]" style={{ color: INK, fontSize: 13 }}>
            Fixed
          </h3>
          <div className="flex gap-2">
            {FIXED_SWATCHES.map(f => (
              <div
                key={f.token}
                className="flex-1 rounded px-1.5 py-2.5 text-center"
                style={{
                  background: f.hex,
                  color: lum(f.hex) > 0.4 ? '#0F0F0F' : '#F5F1E9',
                  border: `1px solid ${LINE}`,
                }}
                title={f.token}
              >
                <div className="font-semibold" style={{ fontSize: 12.5 }}>
                  {f.name}
                </div>
                <div className="opacity-75" style={{ fontSize: 11.5 }}>
                  {f.hex}
                </div>
              </div>
            ))}
          </div>
          <p className="leading-snug" style={{ color: INK_DIM, fontSize: 12 }}>
            The Lab never touches these, nor the grey <code>--secondary</code> surface token.
          </p>
        </section>

        <p className="leading-snug" style={{ color: INK_DIM, fontSize: 12.5 }}>
          {recommendation(purpleSwatch, greenSwatch)}
        </p>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold uppercase tracking-[0.16em]" style={{ color: INK, fontSize: 13 }}>
              Bake into index.css
            </h3>
            <button
              type="button"
              onClick={copyBake}
              className="flex items-center gap-1 rounded px-2 py-1 hover:bg-white/10"
              style={{ fontSize: 12.5 }}
            >
              <Copy style={{ height: 12, width: 12 }} /> Copy
            </button>
          </div>
          <pre
            className="overflow-x-auto rounded p-2.5 font-mono leading-relaxed"
            style={{ background: SURFACE_2, color: INK, border: `1px solid ${LINE}`, fontSize: 12 }}
          >
            {bakeText}
          </pre>
        </section>

        {isSuperadmin && (
          <PublishSection
            purpleHex={purpleHex}
            greenHex={greenHex}
            publishedLabel={
              isEmpty(published)
                ? 'the code defaults'
                : `${published.purple ?? 'code purple'} + ${published.green ?? 'code green'}`
            }
            onDone={reset}
          />
        )}
      </div>
    </div>
  );
}
