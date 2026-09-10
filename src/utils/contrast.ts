/**
 * Picking text that survives whatever it is sitting on.
 *
 * The Islamic design paints the current prayer's row with that prayer's own
 * sky: Fajr's pre-dawn purple, Dhuhr's midday blue fading to near-white, Asr's
 * warm sand. The row's text was white throughout, which works on the night
 * skies and disappears on the daylight ones — Dhuhr's time sat at the pale end
 * of its gradient at about 1.1:1, effectively invisible.
 *
 * Rather than hand-pick a colour per prayer, or flatten the skies to make one
 * colour work, this measures.
 */

/** WCAG relative luminance of a #rgb or #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const channel = (i: number) => {
    const v = parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** A deep warm near-black, so dark text on a sunlit sky still reads as ink
 *  rather than as a hole punched in the row. */
export const WARM_INK = '#221a10';

export interface Ink {
  /** The prayer's name and its time. */
  strong: string;
  /** Its Arabic, and anything else deliberately quieter. */
  soft: string;
  /** A shadow in the opposite direction, to hold the edge of each glyph. */
  shadow: string;
}

const LIGHT_INK: Ink = {
  strong: '#ffffff',
  soft: 'rgba(255,255,255,0.85)',
  shadow: '0 1px 3px rgba(0,0,0,0.5), 0 0 6px rgba(0,0,0,0.3)',
};

const DARK_INK: Ink = {
  strong: WARM_INK,
  soft: 'rgba(34,26,16,0.78)',
  shadow: '0 1px 2px rgba(255,255,255,0.45)',
};

/**
 * Whichever of the two inks reads better on `background`. Measured rather than
 * thresholded, so adding a sky to the palette cannot quietly produce an
 * unreadable row.
 */
export function readableInkOn(background: string): Ink {
  return contrastRatio(background, DARK_INK.strong) > contrastRatio(background, LIGHT_INK.strong)
    ? DARK_INK
    : LIGHT_INK;
}
