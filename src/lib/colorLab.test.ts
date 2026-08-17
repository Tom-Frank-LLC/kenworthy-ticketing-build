import { describe, it, expect, beforeEach } from 'vitest';
import {
  GREENS,
  PURPLES,
  SHIPPED_GREEN,
  SHIPPED_PURPLE,
  applyTokens,
  contrastVsBg,
  forgetSwatch,
  hexToHslCss,
  hexToHslToken,
  isHex,
  lum,
  pickForeground,
  pickForegroundHex,
  readLabState,
  readSaved,
  saveSwatch,
  savedSwatch,
  tierFromC,
  writeLabState,
  OFF,
} from './colorLab';

/**
 * The Lab repaints the real site, so the two things worth pinning are the
 * conversions (a wrong triplet is a wrong site) and the teardown (an override
 * left behind is a theme nobody chose).
 */

describe('hex → HSL token', () => {
  it('round-trips the shipped tokens back to the values in index.css', () => {
    // If either of these drifts, SHIPPED_PURPLE/SHIPPED_GREEN no longer describe
    // what the stylesheet ships, and "Reset" would land somewhere else.
    expect(hexToHslToken(SHIPPED_PURPLE)).toBe('278 58% 64%');
    expect(hexToHslToken(SHIPPED_GREEN)).toBe('142 60% 42%');
  });

  it('rejects anything that is not a six-digit hex', () => {
    expect(isHex('#B16ED8')).toBe(true);
    expect(isHex('#b16ed8')).toBe(true);
    expect(isHex('#FFF')).toBe(false);
    expect(isHex('rebeccapurple')).toBe(false);
    expect(isHex('')).toBe(false);
  });
});

describe('contrast', () => {
  it('measures against the real background, not pure black', () => {
    // #0F0F0F, not #000 — measuring against pure black flatters every swatch.
    expect(contrastVsBg('#0F0F0F')).toBeCloseTo(1, 5);
    expect(contrastVsBg('#B16ED8')).toBeCloseTo(5.6, 1);
  });

  it('puts the 4.5:1 text floor at the tier boundary', () => {
    expect(tierFromC(4.5)).toBe('pass');
    expect(tierFromC(4.4)).toBe('large');
    expect(tierFromC(3)).toBe('large');
    expect(tierFromC(2.9)).toBe('low');
  });
});

describe('pickForeground', () => {
  it('agrees with the shipped theme on the shipped purple', () => {
    // The standalone Lab used `lum > 0.4`, which picks cream here (3.1:1) over
    // the off-black index.css actually ships (5.6:1). Opening the Lab must not
    // make buttons harder to read than leaving it shut.
    expect(pickForeground(SHIPPED_PURPLE)).toBe('0 0% 6%');
  });

  it('agrees with the shipped theme on the shipped green', () => {
    // index.css ships `--success-foreground: 0 0% 6%`, and these two must not
    // drift apart: green is a solid CTA fill now, so the pair is load-bearing.
    // It used to be cream, which is 2.75:1 on this emerald — the mismatch was
    // invisible while --success only ever appeared as a 15% tint.
    expect(pickForeground(SHIPPED_GREEN)).toBe('0 0% 6%');
  });

  it('names exactly the swatches that cannot carry button text at 4.5:1', () => {
    // Deliberately a record, not a floor. The Lab's job is to show candidates
    // *including* the poor ones — "Old Magenta" is only there to be rejected —
    // so a swatch below the floor must be visible in the panel, not quietly
    // dropped from it. This list is what the panel's "button" ratio warns
    // about; if it changes, the palette changed and somebody should know.
    const failing = [...PURPLES, ...GREENS]
      .filter(s => s.cInk < 4.5)
      .map(s => `${s.name} ${s.cInk}:1`);
    expect(failing).toEqual(['Heritage Grape 4.2:1']);
  });

  it('measures the button ratio against the ink it actually picks', () => {
    const cr = (a: string, b: string) =>
      (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const s of [...PURPLES, ...GREENS]) {
      expect(s.cInk).toBeCloseTo(+cr(s.hex, pickForegroundHex(s.hex)).toFixed(1), 5);
      expect(s.tierInk).toBe(tierFromC(s.cInk));
    }
  });

  it('still puts cream on the dark greens', () => {
    expect(pickForeground('#195738')).toBe('38 30% 94%');
    expect(pickForeground('#24604A')).toBe('38 30% 94%');
  });

  it('always picks the higher-contrast of the two inks', () => {
    // contrastVsBg is fixed to the page background, so measure swatch-vs-ink
    // here with the exported luminance instead.
    const cr = (a: string, b: string) =>
      (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const s of [...PURPLES, ...GREENS]) {
      const chosen = pickForeground(s.hex) === '0 0% 6%' ? '#0F0F0F' : '#F4F1EB';
      const rejected = chosen === '#0F0F0F' ? '#F4F1EB' : '#0F0F0F';
      expect(cr(s.hex, chosen)).toBeGreaterThanOrEqual(cr(s.hex, rejected));
    }
  });
});

describe('palettes', () => {
  it('offers the shipped colours as the first swatch in each grid', () => {
    expect(PURPLES[0].hex).toBe(SHIPPED_PURPLE);
    expect(GREENS[0].hex).toBe(SHIPPED_GREEN);
  });

  it('keeps the previous magenta available for comparison', () => {
    expect(PURPLES.some(p => p.hex === '#E42D8C')).toBe(true);
  });

  it('derives every metric rather than carrying a hand-typed one', () => {
    for (const s of [...PURPLES, ...GREENS]) {
      expect(s.c).toBeCloseTo(+contrastVsBg(s.hex).toFixed(1), 5);
      expect(s.tier).toBe(tierFromC(s.c));
      expect(s.hsl).toBe(hexToHslToken(s.hex));
    }
  });
});

describe('applying and clearing overrides', () => {
  const root = () => document.documentElement.style;

  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    window.sessionStorage.clear();
  });

  it('drives every purple and green token from one pick', () => {
    applyTokens('#B262DA', '#73A94C');
    // Full precision, not the rounded token — so the pixels match the hex the
    // contrast readout measured.
    for (const t of ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring', '--chart-1']) {
      expect(root().getPropertyValue(t)).toBe(hexToHslCss('#B262DA'));
    }
    for (const t of ['--success', '--chart-3']) {
      expect(root().getPropertyValue(t)).toBe(hexToHslCss('#73A94C'));
    }
    expect(root().getPropertyValue('--primary-foreground')).toBe(pickForeground('#B262DA'));
    expect(root().getPropertyValue('--success-foreground')).toBe(pickForeground('#73A94C'));
    // The grey surface token is the naming trap; the Lab must never touch it.
    expect(root().getPropertyValue('--secondary')).toBe('');
    expect(root().getPropertyValue('--accent')).toBe('');
    expect(root().getPropertyValue('--background')).toBe('');
    expect(root().getPropertyValue('--foreground')).toBe('');
  });

  it('removes the inline properties on reset rather than writing defaults back', () => {
    // Restoring by removal is what keeps index.css the single source of truth.
    applyTokens('#B262DA', '#73A94C');
    applyTokens(null, null);
    for (const t of ['--primary', '--ring', '--success', '--chart-1', '--chart-3']) {
      expect(root().getPropertyValue(t)).toBe('');
    }
    expect(document.documentElement.getAttribute('style')).toBe('');
  });

  it('clears one channel without disturbing the other', () => {
    applyTokens('#B262DA', '#73A94C');
    applyTokens(null, '#73A94C');
    expect(root().getPropertyValue('--primary')).toBe('');
    expect(root().getPropertyValue('--success')).toBe(hexToHslCss('#73A94C'));
  });

  it('knows nothing about where the colours came from', () => {
    // applyTokens is deliberately layer-agnostic: the session-override /
    // published-theme precedence is resolved before anything reaches it, which
    // is what keeps the two layers from having to know about each other.
    // Passing nulls is how "no override" is expressed, whatever the reason.
    applyTokens(null, null);
    // No attribute at all when nothing was ever set — `getAttribute` gives null
    // here and '' once a property has been set and removed. Both mean "clean".
    expect(document.documentElement.getAttribute('style') || '').toBe('');
  });
});

describe('saved custom swatches', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps saved picks in localStorage, not sessionStorage', () => {
    // The theme override is per-tab and disposable on purpose; a saved swatch
    // is a scratchpad for a decision that takes days, so it must outlive a tab.
    saveSwatch('green', '#125a51');
    expect(window.sessionStorage.getItem('kenworthy.colorlab.saved')).toBeNull();
    expect(readSaved().green).toEqual(['#125A51']);
  });

  it('normalises case and refuses duplicates and junk', () => {
    saveSwatch('purple', '#b262da');
    saveSwatch('purple', '#B262DA');
    saveSwatch('purple', 'not-a-colour');
    expect(readSaved().purple).toEqual(['#B262DA']);
  });

  it('keeps the two channels apart', () => {
    saveSwatch('purple', '#B262DA');
    saveSwatch('green', '#125A51');
    expect(readSaved()).toEqual({ purple: ['#B262DA'], green: ['#125A51'] });
  });

  it('forgets one without disturbing the rest', () => {
    saveSwatch('green', '#125A51');
    saveSwatch('green', '#73A94C');
    forgetSwatch('green', '#125a51');
    expect(readSaved().green).toEqual(['#73A94C']);
  });

  it('survives tampered storage instead of throwing', () => {
    window.localStorage.setItem('kenworthy.colorlab.saved', '{"green":[1,2,"#ZZZZZZ"]}');
    expect(readSaved()).toEqual({ purple: [], green: [] });
  });

  it('gives a saved hex the same metrics as a preset', () => {
    const s = savedSwatch('#125A51');
    expect(s.hsl).toBe(hexToHslToken('#125A51'));
    expect(s.tierInk).toBe(tierFromC(s.cInk));
  });
});

describe('the session store', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('round-trips an open lab', () => {
    writeLabState({ on: true, purple: '#B262DA', green: null });
    expect(readLabState()).toEqual({ on: true, purple: '#B262DA', green: null });
  });

  it('forgets the lab entirely when it is closed', () => {
    writeLabState({ on: true, purple: '#B262DA', green: '#73A94C' });
    writeLabState(OFF);
    expect(window.sessionStorage.getItem('kenworthy.colorlab')).toBeNull();
    expect(readLabState()).toEqual(OFF);
  });

  it('ignores a tampered or half-written value instead of painting with it', () => {
    window.sessionStorage.setItem(
      'kenworthy.colorlab',
      JSON.stringify({ on: true, purple: 'javascript:alert(1)', green: 42 }),
    );
    expect(readLabState()).toEqual({ on: true, purple: null, green: null });
  });

  it('survives unparseable storage', () => {
    window.sessionStorage.setItem('kenworthy.colorlab', '{not json');
    expect(readLabState()).toEqual(OFF);
  });
});
