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
import { contrast, format, luminance, luminanceRgb, mix, parse } from './color.mjs'

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
 * Text brightness is a **continuum**: every value between `min` and `max` is
 * settable, in `step` increments. 0.05 of contrast is ~1% of luminance, i.e.
 * below the point where a step is visible, so the slider reads as smooth while
 * still quantising (the quantised value is what gets persisted and published,
 * which keeps a drag from emitting a publish per pixel).
 */
export const TEXT_RANGE = { min: 8, max: 11.5, step: 0.05 }

/**
 * Page brightness is continuous too: a luminance multiplier, not a stop id.
 * 0.01 of factor is imperceptible, so quantising to it costs nothing visually
 * and bounds the repaint rate.
 */
export const PAGE_RANGE = { min: 0.7, max: 1.45, step: 0.01 }

/**
 * Named landmarks on the text scale. They are **presets, not the scale**: the
 * slider can rest anywhere, these are the values the names refer to and what the
 * readout falls back to for a human word ("柔和" instead of "9.60").
 */
export const TEXT_PRESETS = [
  { id: 'standard', label: { zh: '标准', en: 'Standard' }, value: 11.5 },
  { id: 'gentle', label: { zh: '偏柔', en: 'Gentle' }, value: 10.85 },
  { id: 'mild', label: { zh: '较柔', en: 'Mild' }, value: 10.2 },
  { id: 'soft', label: { zh: '柔和', en: 'Soft' }, value: 9.6 },
  { id: 'softer', label: { zh: '更柔和', en: 'Softer' }, value: 8 },
]

/** Named landmarks on the page-brightness scale (100% = the palette's own values). */
export const PAGE_PRESETS = [
  { id: 'dim', label: { zh: '很暗', en: 'Dim' }, value: 0.7 },
  { id: 'dimmer', label: { zh: '偏暗', en: 'Dim-ish' }, value: 0.8 },
  { id: 'dimmish', label: { zh: '略暗', en: 'Slightly dim' }, value: 0.9 },
  { id: 'standard', label: { zh: '标准', en: 'Standard' }, value: 1 },
  { id: 'brighter', label: { zh: '略亮', en: 'Slightly bright' }, value: 1.12 },
  { id: 'bright', label: { zh: '偏亮', en: 'Bright-ish' }, value: 1.28 },
  { id: 'brightest', label: { zh: '很亮', en: 'Brightest' }, value: 1.45 },
]

/** Value used until the user moves the slider. */
export const DEFAULT_TEXT_VALUE = 9.6
/** Value used until the user moves the slider. */
export const DEFAULT_PAGE_VALUE = 1

/** Clamp onto the range's grid; rounds to 2 decimals so `9.600000000000001` never leaks out. */
export function quantizeValue(value, range, fallback) {
  // `Number(null) === 0` and `Number('') === 0`, so an absent setting would
  // otherwise clamp to the bottom of the range instead of using the default.
  if (value === null || value === undefined || value === '') return fallback
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  const clamped = Math.min(range.max, Math.max(range.min, numeric))
  return Math.round(Math.round(clamped / range.step) * range.step * 100) / 100
}

/**
 * Resolve whatever the caller stored into a value on the scale.
 *
 * Accepts a number (the normal case) and the legacy named stop ids from the
 * fixed-5-stops release, so a stored `"soft"` still means 9.6 after upgrading.
 *
 * @param input - number, numeric string, or legacy preset id.
 * @param range - `TEXT_RANGE` or `PAGE_RANGE`.
 * @param presets - the matching preset list.
 * @param fallback - value to use when `input` is unusable.
 * @returns a quantised value inside the range.
 */
export function resolveValue(input, range, presets, fallback) {
  if (typeof input === 'string') {
    const preset = presets.find((candidate) => candidate.id === input)
    if (preset !== undefined) return preset.value
  }
  return quantizeValue(input, range, fallback)
}

/** The preset a value is closest to — for the human-readable readout. */
export function nearestPreset(value, presets) {
  let best = presets[0]
  for (const preset of presets) {
    if (Math.abs(preset.value - value) < Math.abs(best.value - value)) best = preset
  }
  return best
}

/**
 * How far to warm the copy for a given text-brightness value.
 *
 * Dimmer copy is warmed further (that is the whole point of the slider); the
 * brightest setting keeps the palette's own hue almost intact so "标准" still
 * looks like the designed palette.
 *
 * @param value - text-brightness value on {@link TEXT_RANGE}.
 * @returns a 0.35..1.4 multiplier applied to the palette's own `textWarmth`.
 */
export function warmthFor(value) {
  const span = TEXT_RANGE.max - TEXT_RANGE.min
  const position = span === 0 ? 0 : (TEXT_RANGE.max - value) / span
  return 0.4 + Math.max(0, Math.min(1, position)) * 0.95
}

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
/**
 * The two neighbouring 8-bit colours around a luminance target.
 * @param color - colour to move.
 * @param target - desired luminance.
 * @returns `[under, over]` in luminance terms (either may equal the other after rounding).
 */
function bracketAt(color, target) {
  const [r, g, b, a] = parse(color)
  const darken = luminance(color) > target
  const [tr, tg, tb] = darken ? [0, 0, 0] : [255, 255, 255]
  // The channels move linearly, so bisect on the mix ratio and score each probe
  // with luminanceRgb — no hex round-trip per iteration.
  let low = 0
  let high = 1
  for (let step = 0; step < 18; step += 1) {
    const mid = (low + high) / 2
    const value = luminanceRgb(r + (tr - r) * mid, g + (tg - g) * mid, b + (tb - b) * mid)
    if (darken ? value > target : value < target) low = mid
    else high = mid
  }
  const at = (k) => format([r + (tr - r) * k, g + (tg - g) * k, b + (tb - b) * k, a])
  return [at(low), at(high)]
}

/** Move a colour onto a luminance target, landing as close as 8-bit allows. */
function colorAtLuminance(color, target) {
  if (Math.abs(luminance(color) - target) <= 0.0002) return color
  const [below, above] = bracketAt(color, target)
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
  const clamped = Math.max(0.0006, Math.min(0.985, desired))
  if (Math.abs(current - clamped) <= 0.0002) return color
  const [r, g, b, a] = parse(color)
  const darken = luminance(color) > clamped
  const [tr, tg, tb] = darken ? [0, 0, 0] : [255, 255, 255]
  const [, boundary] = bracketAt(color, clamped)
  const ratio = mixRatioOf(boundary, color, darken ? '#000000' : '#ffffff')
  // Land on the **highest contrast that does not exceed the target**. A single
  // 8-bit step is coarser than the slider's step, so the neighbourhood is walked
  // explicitly: biasing down makes the achieved contrast a monotone function of
  // the target, which is what stops neighbouring slider values from inverting.
  const at = (k) => format([r + (tr - r) * k, g + (tg - g) * k, b + (tb - b) * k, a])
  // Step down from the boundary until the target is not exceeded. Walking in one
  // direction (never "nearest of two ends") is what makes the achieved contrast a
  // monotone function of the target: a smaller target starts lower and stops lower.
  // Which way lowers contrast depends on whether the copy is above or below the
  // surface, so probe once instead of reasoning about it: the whole point of this
  // walk is that it must never step away from the target.
  const clampedRatio = Math.max(0, Math.min(1, ratio))
  const here = contrast(at(clampedRatio), surface)
  if (here <= target + 1e-9) return at(clampedRatio)
  const sign = contrast(at(Math.min(1, clampedRatio + 1 / 255)), surface) < here ? 1 : -1
  for (let step = 1; step <= 20; step += 1) {
    const k = Math.max(0, Math.min(1, clampedRatio + (sign * step) / 255))
    const hex = at(k)
    if (contrast(hex, surface) <= target + 1e-9) return hex
  }
  return at(sign > 0 ? 1 : 0)
}

/**
 * Inverse of a two-stop mix: how much of `toward` is in `hex`.
 * @param hex - the mixed colour (8-bit, so approximate).
 * @param from - the start colour.
 * @param toward - the end colour.
 * @returns the mix ratio, clamped to 0..1.
 */
function mixRatioOf(hex, from, toward) {
  const [r, g, b] = parse(hex)
  const [r0, g0, b0] = parse(from)
  const [r1, g1, b1] = parse(toward)
  const channels = [
    [r, r0, r1],
    [g, g0, g1],
    [b, b0, b1],
  ]
  let total = 0
  let count = 0
  for (const [value, start, end] of channels) {
    if (end === start) continue
    total += (value - start) / (end - start)
    count += 1
  }
  return count === 0 ? 0 : Math.min(1, Math.max(0, total / count))
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
  const pageFactor = resolveValue(options?.page, PAGE_RANGE, PAGE_PRESETS, DEFAULT_PAGE_VALUE)
  const textValue = resolveValue(options?.text, TEXT_RANGE, TEXT_PRESETS, DEFAULT_TEXT_VALUE)
  const skew = clamp01((palette?.textWarmth ?? 0.15) * warmthFor(textValue))

  const out = {}
  for (const [name, pair] of Object.entries(pairs)) out[name] = { light: pair.light, dark: pair.dark }

  // 1. Page brightness: surfaces only, hue preserved.
  if (pageFactor !== 1) {
    for (const name of SURFACE_TOKENS) {
      const pair = out[name]
      if (pair === undefined) continue
      for (const mode of MODES) {
        if (!isPlainColor(pair[mode])) continue
        // A light page sits close to white: brighting it would clip, so damp that
        // direction only. Dimming stays at full strength — dimming a paper page is
        // the main reason to reach for this slider.
        const factor = mode === 'light' && pageFactor > 1 ? 1 + (pageFactor - 1) * 0.2 : pageFactor
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

    const target = Math.min(19, textValue)
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
  const textValue = resolveValue(options?.text, TEXT_RANGE, TEXT_PRESETS, DEFAULT_TEXT_VALUE)
  const pageFactor = resolveValue(options?.page, PAGE_RANGE, PAGE_PRESETS, DEFAULT_PAGE_VALUE)
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
      textValue,
      pageFactor,
    }
  }
  return result
}
