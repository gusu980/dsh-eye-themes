/**
 * Runtime tuning: page brightness × text brightness.
 *
 * Both knobs act on one palette at apply time instead of being pre-generated:
 * 5 palettes × 7 brightness stops × 5 text stops would be 175 full token maps,
 * and — more importantly — **text contrast must be recomputed against the
 * brightened surface**, so the two knobs cannot be baked independently.
 *
 * Only two things are ever adjusted:
 *  1. `page` scales the luminance of the surface tokens (never their hue);
 *  2. `text` warms the copy toward an off-white and lands each label tier on a
 *     target contrast measured against the *tuned* background.
 *
 * Light themes' dark copy is never re-hued: black text does not glare. Its
 * contrast drifts slightly with page brightness, in the safe direction.
 *
 * This module is pure and dependency-free apart from `./color.mjs`; the bundle
 * build inlines both (see tools/build.mjs), and the verifier imports it directly
 * to check the whole matrix.
 */
import { contrast, luminance, mix } from './color.mjs'

/** Off-white the copy leans toward; ~3800K reads warm without turning sepia. */
const WARM_WHITE = '#FFE9CE'
/** Readability floor: no stop may push copy below this. */
const TIER_FLOOR = 4
/** Surfaces never reach a pure white page or a crushed black one. */
const SURFACE_LUMINANCE_MAX = 0.95
const SURFACE_LUMINANCE_MIN = 0.006

/**
 * Tokens that are *surfaces* — what "page brightness" moves. Everything else
 * (copy, accents, states) is left to its own control or to the palette.
 */
export const SURFACE_TOKENS = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-multi-select',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-document-preview',
  '--dsw-alias-bg-skeleton',
  '--dsw-alias-bg-mask-drop',
  '--dsw-alias-settings-card-fill',
  '--dsw-alias-button-elevated-fill',
  '--dsw-alias-button-floating-fill',
  '--dsw-alias-button-floating-hover',
  '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-block-banner',
  '--dsw-alias-markdown-code-segment-selected',
  '--dsw-alias-markdown-code-segment-unselected',
  '--dsw-alias-tooltip-key-bg',
  '--dsw-alias-toast-bg',
  '--dsw-alias-tooltip-bg',
  '--dsw-alias-onboarding-card-fill',
  '--dsw-alias-onboarding-secondary-fill',
  '--dsw-specific-sidebar-fill',
  '--dsw-specific-sidebar-nav-item-hover',
  '--dsw-specific-sidebar-nav-item-active',
  '--dsw-specific-menu',
  '--dsw-menu-surface-fill',
  '--dsw-specific-bubble',
  '--dsw-specific-bubble-highlight',
  '--dsw-specific-input-major',
  '--dsw-specific-login-input',
  '--dsw-specific-selector',
  '--dsw-specific-tip',
]

/**
 * The label ramp, as a fraction of the primary tier's contrast target. Working
 * in contrast (not colour) is what keeps the ramp monotonic: secondary can
 * never out-glow primary, whatever the two sliders say.
 */
export const COPY_TIERS = {
  '--dsw-alias-label-primary': 1,
  '--dsw-alias-label-primary-foreground': 1,
  '--dsw-alias-label-primary-dimmed': 0.85,
  '--dsw-alias-label-primary-bluish': 0.85,
  '--dsw-alias-label-document-preview': 0.78,
  '--dsw-alias-label-deep-diving': 0.78,
  '--dsw-alias-label-secondary': 0.76,
  '--dsw-alias-label-tertiary': 0.6,
  '--dsw-alias-label-caption': 0.56,
  '--dsw-alias-label-shimmer': 0.6,
  '--dsw-alias-label-deep-diving-shimmer': 0.58,
  '--dsw-alias-label-dimmed': 0.5,
}

/** Accent copy: dimmed with the ramp so it fits, but never re-hued — a link must read as a link. */
export const ACCENT_COPY_TOKENS = ['--dsw-alias-link']

/** Copy on a filled accent: warmed toward the off-white, never dimmed below the fill's own contrast. */
export const ON_FILL_COPY_TOKENS = [
  '--dsw-alias-brand-text',
  '--dsw-alias-toast-label',
  '--dsw-alias-label-primary-inverted',
  '--dsw-alias-switch-thumb',
]

/**
 * Text brightness stops, brightest first. `ceiling` is the maximum contrast the
 * brightest copy may reach against its (already brightened) surface; the two
 * stops between `standard` and `soft` exist because that gap was the one users
 * kept wanting to split.
 */
export const TEXT_STOPS = [
  { id: 'standard', label: { zh: '标准', en: 'Standard' }, ceiling: 11.5, warmth: 0.55 },
  { id: 'gentle', label: { zh: '偏柔', en: 'Gentle' }, ceiling: 10.85, warmth: 0.7 },
  { id: 'mild', label: { zh: '较柔', en: 'Mild' }, ceiling: 10.2, warmth: 0.85 },
  { id: 'soft', label: { zh: '柔和', en: 'Soft' }, ceiling: 9.6, warmth: 1 },
  { id: 'softer', label: { zh: '更柔和', en: 'Softer' }, ceiling: 8, warmth: 1.35 },
]

/** Stop used until the user moves the slider. */
export const DEFAULT_TEXT_STOP = 'soft'

/**
 * Page brightness stops, dimmest first. `factor` multiplies surface *luminance*,
 * not channel values: a near-black page has to move further in luminance to read
 * as "dimmer", and a paper page is already within 15% of white so it only has
 * room to go down. The ladder is asymmetric for that reason.
 */
export const PAGE_STOPS = [
  { id: 'dim', label: { zh: '很暗', en: 'Dim' }, factor: 0.7 },
  { id: 'dimmer', label: { zh: '偏暗', en: 'Dim-ish' }, factor: 0.8 },
  { id: 'dimmish', label: { zh: '略暗', en: 'Slightly dim' }, factor: 0.9 },
  { id: 'standard', label: { zh: '标准', en: 'Standard' }, factor: 1 },
  { id: 'brighter', label: { zh: '略亮', en: 'Slightly bright' }, factor: 1.12 },
  { id: 'bright', label: { zh: '偏亮', en: 'Bright-ish' }, factor: 1.28 },
  { id: 'brightest', label: { zh: '很亮', en: 'Brightest' }, factor: 1.45 },
]

/** Stop used until the user moves the slider. */
export const DEFAULT_PAGE_STOP = 'standard'

const MODES = ['light', 'dark']

const clamp01 = (value) => Math.max(0, Math.min(1, value))

/**
 * Only opaque hex values can be re-luminanced. Overlays (`rgba(...)`, `color-mix`,
 * gradients) are left exactly as the palette wrote them — they are relative
 * layers on top of a surface, not surfaces themselves.
 */
const isPlainColor = (value) => typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)

/** Resolve a stop id to its record, falling back to the default stop. */
function resolveStop(stops, id, fallbackId) {
  return stops.find((stop) => stop.id === id) ?? stops.find((stop) => stop.id === fallbackId) ?? stops[0]
}

/**
 * Mix toward black or white until the measured luminance reaches `target`.
 * Bisection, because fixed mixing steps quantise a near-black surface into
 * visible jumps and make adjacent slider stops collapse onto one colour.
 */
function colorAtLuminance(color, target) {
  const current = luminance(color)
  if (Math.abs(current - target) <= 0.0002) return color
  const toward = current > target ? '#000000' : '#ffffff'
  let low = 0
  let high = 1
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2
    const value = luminance(mix(color, toward, mid))
    if (toward === '#000000' ? value > target : value < target) low = mid
    else high = mid
  }
  // 8-bit rounding means one side of the bracket can land closer than the other.
  const below = mix(color, toward, low)
  const above = mix(color, toward, high)
  return Math.abs(luminance(below) - target) <= Math.abs(luminance(above) - target) ? below : above
}

/** Mix a copy colour toward the warm off-white (light copy warms, dark copy warms and lifts). */
const numix = (color, amount) => (amount > 0 ? mix(color, WARM_WHITE, clamp01(amount)) : color)

/**
 * Keep a copy colour's hue but land it exactly on a contrast target, moving it in
 * whichever direction the copy sits relative to its surface: light copy is dimmed,
 * dark copy is lifted. Both directions are the same request — "this much contrast,
 * not more" — which is why one rule serves both the glare case and the too-black
 * case on a paper page.
 */
function colorAtContrast(color, surface, target) {
  const background = luminance(surface)
  const current = luminance(color)
  const desired = current > background
    ? target * (background + 0.05) - 0.05
    : (background + 0.05) / target - 0.05
  return colorAtLuminance(color, Math.max(0.0006, Math.min(0.985, desired)))
}

/**
 * Apply the two knobs to one palette's token pairs.
 *
 * @param pairs - `{ [token]: { light, dark } }`, the palette's full override map.
 * @param palette - palette record; only `textWarmth` is read (0..1 hue skew for copy).
 * @param options - `{ page?: string, text?: string }` stop ids (unknown ids fall back).
 * @returns a new pairs map; the input is never mutated.
 */
export function tune(pairs, palette, options) {
  const page = resolveStop(PAGE_STOPS, options?.page, DEFAULT_PAGE_STOP)
  const text = resolveStop(TEXT_STOPS, options?.text, DEFAULT_TEXT_STOP)
  const skew = clamp01((palette?.textWarmth ?? 0.15) * text.warmth)

  const out = {}
  for (const [name, pair] of Object.entries(pairs)) out[name] = { light: pair.light, dark: pair.dark }

  // 1. Page brightness: surfaces only, hue preserved.
  if (page.factor !== 1) {
    for (const name of SURFACE_TOKENS) {
      const pair = out[name]
      if (pair === undefined) continue
      for (const mode of MODES) {
        if (!isPlainColor(pair[mode])) continue
        // A light page sits close to white: brighting it would clip, so damp that
        // direction only. Dimming stays at full strength — dimming a paper page is
        // the main reason to reach for this slider.
        const factor = mode === 'light' && page.factor > 1 ? 1 + (page.factor - 1) * 0.2 : page.factor
        const target = Math.min(SURFACE_LUMINANCE_MAX, Math.max(SURFACE_LUMINANCE_MIN, luminance(pair[mode]) * factor))
        pair[mode] = colorAtLuminance(pair[mode], target)
      }
    }
  }

  // 2. Text brightness: warm the copy toward the off-white, then land each label
  // tier on its contrast target measured against the *tuned* surface.
  //
  // One path for both directions. On a dark page the copy is lightened and capped
  // (the glare case); on a light page the dark copy is warmed and lifted off pure
  // black by the same rule — which is the same request seen from the other side,
  // and it means the slider is never dead on a light theme.
  for (const mode of MODES) {
    const base = out['--dsw-alias-bg-base']?.[mode]
    const primaryRaw = pairs['--dsw-alias-label-primary']?.[mode]
    if (base === undefined || primaryRaw === undefined || !isPlainColor(base) || !isPlainColor(primaryRaw)) continue

    const target = Math.min(19, text.ceiling)
    const primary = colorAtContrast(numix(primaryRaw, skew), base, target)
    out['--dsw-alias-label-primary'][mode] = primary

    for (const [name, tier] of Object.entries(COPY_TIERS)) {
      if (name === '--dsw-alias-label-primary') continue
      const pair = out[name]
      if (pair === undefined) continue
      const value = pairs[name][mode]
      if (!isPlainColor(value)) continue
      const warmed = numix(value, skew * Math.min(1, luminance(value) * 1.15))
      // A tier keeps its share of the target but never exceeds the palette's own value.
      pair[mode] = colorAtContrast(warmed, base, Math.max(TIER_FLOOR, target * Math.min(1, tier)))
    }

    for (const name of ACCENT_COPY_TOKENS) {
      const pair = out[name]
      if (pair === undefined) continue
      const value = pairs[name][mode]
      if (!isPlainColor(value)) continue
      pair[mode] = colorAtContrast(value, base, Math.max(TIER_FLOOR, target * 0.72))
    }

    for (const name of ON_FILL_COPY_TOKENS) {
      const pair = out[name]
      if (pair === undefined || !isPlainColor(pair[mode]) || luminance(pair[mode]) < 0.6) continue
      pair[mode] = numix(pair[mode], Math.min(0.5, skew))
    }
  }

  return out
}

/**
 * Contrast each label tier ends up on, for the README tables and the verifier.
 * @param pairs - palette override map.
 * @param palette - palette record.
 * @param options - stop ids.
 * @returns `{ light: {...}, dark: {...} }` with the measured ratios.
 */
export function measure(pairs, palette, options) {
  const tuned = tune(pairs, palette, options)
  const result = {}
  for (const mode of MODES) {
    const base = tuned['--dsw-alias-bg-base'][mode]
    const raw = tuned['--dsw-alias-label-primary'][mode]
    const lightCopy = luminance(raw) > luminance(base)
    result[mode] = {
      base,
      primary: contrast(raw, base),
      secondary: contrast(tuned['--dsw-alias-label-secondary'][mode], base),
      tertiary: contrast(tuned['--dsw-alias-label-tertiary'][mode], base),
      link: contrast(tuned['--dsw-alias-link'][mode], base),
      shikiMin: Math.min(
        ...[
          '--shiki-token-constant',
          '--shiki-token-string',
          '--shiki-token-keyword',
          '--shiki-token-parameter',
          '--shiki-token-function',
          '--shiki-token-string-expression',
          '--shiki-token-link',
        ].map((name) => contrast(tuned[name][mode], tuned['--dsw-alias-markdown-code-block'][mode])),
      ),
      primaryHex: raw,
      lightCopy,
    }
  }
  return result
}
