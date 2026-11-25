/**
 * Tiny color toolkit: hex parsing, sRGB mixing, alpha, WCAG luminance/contrast.
 * No dependencies — the palette build must stay reproducible on a bare Node.
 */

/** Parse #rgb / #rrggbb (with optional alpha) into [r, g, b, a]. */
export function parse(input) {
  const hex = input.trim().replace(/^#/, '')
  const expand = (h) => (h.length === 1 ? h + h : h)
  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a = 'f'] = [...hex].map(expand)
    return [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16), parseInt(a, 16) / 255]
  }
  if (hex.length === 6 || hex.length === 8) {
    const a = hex.length === 8 ? hex.slice(6, 8) : 'ff'
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(parseInt(a, 16) / 255)
  }
  throw new Error(`unsupported color: ${input}`)
}

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)))
const byte = (value) => clamp(value).toString(16).padStart(2, '0')

/** Serialize back to #rrggbb, or rgba() when translucent. */
export function format([r, g, b, a]) {
  if (a >= 1) return `#${byte(r)}${byte(g)}${byte(b)}`
  return `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${Number(a.toFixed(3))})`
}

/** Alpha variant of a color (0..1). */
export function alpha(color, a) {
  const [r, g, b] = parse(color)
  return format([r, g, b, a])
}

/** Linear mix: t=0 returns `a`, t=1 returns `b`. Alpha follows `a` unless `keepAlpha` is off. */
export function mix(a, b, t) {
  const [r1, g1, b1, a1] = parse(a)
  const [r2, g2, b2] = parse(b)
  const k = Math.max(0, Math.min(1, t))
  return format([r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k, a1])
}

/** Lighten toward white by t; `toward` picks the direction (use the base surface for "lighten" in dark mode). */
export function lighten(color, t, toward = '#ffffff') {
  return mix(color, toward, t)
}

/**
 * WCAG relative luminance from raw 0..255 channels.
 *
 * Split out because the tuner bisects a colour toward a luminance target and
 * would otherwise round-trip through a hex string on every iteration.
 *
 * @param red - 0..255 (fractional values allowed).
 * @param green - 0..255.
 * @param blue - 0..255.
 * @returns relative luminance, 0..1.
 */
export function luminanceRgb(red, green, blue) {
  const channel = (value) => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

/** WCAG relative luminance (alpha ignored: palettes are opaque where it matters). */
export function luminance(color) {
  const cached = LUMINANCE_CACHE.get(color)
  if (cached !== undefined) return cached
  const [r, g, b] = parse(color)
  const value = luminanceRgb(r, g, b)
  if (LUMINANCE_CACHE.size > 8192) LUMINANCE_CACHE.clear()
  LUMINANCE_CACHE.set(color, value)
  return value
}

/** Repeated colours (palette values, the warm off-white) dominate a tune pass. */
const LUMINANCE_CACHE = new Map()

/** WCAG contrast ratio between two opaque colors (1..21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Pick the more legible of near-black / near-white for text on `background`. */
export function readableOn(background, dark = '#1a1a1a', light = '#fafafa') {
  return contrast(background, dark) >= contrast(background, light) ? dark : light
}

/** Raise contrast of `foreground` against `background` until it clears `target`, by stepping toward black/white. */
export function ensureContrast(foreground, background, target = 4.5) {
  if (contrast(foreground, background) >= target) return foreground
  const darker = luminance(background) > 0.5
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(foreground, darker ? '#000000' : '#ffffff', step * 0.05)
    if (contrast(candidate, background) >= target) return candidate
  }
  return foreground
}
