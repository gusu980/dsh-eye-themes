/**
 * Library entry — for hosts that are **not** DeepSeek Harness.
 *
 * The DSH half of this package is a client-plugin bundle (`./client`) that needs
 * the host's `theme` / `slots` / `locale` services and its `--dsw-*` token
 * vocabulary. None of that exists in an ordinary React app, so a different host
 * consumes this package as a plain library instead: the five palettes and the
 * two brightness knobs are pure functions over colour strings, and this module
 * turns their output into whatever the host actually reads.
 *
 * Zero dependencies, no DOM, no React. Safe to import from a Vite/Node/RSC
 * build; tree-shakeable.
 *
 * @example
 * import { buildPalette, toCssText } from 'dsh-eye-themes/export'
 *
 * const { pairs } = buildPalette('paper', { page: 'dim', text: 'soft' })
 * const css = toCssText(pairs, { darkSelector: '.theme-dark' })
 */
import { contrast, luminance } from './color.mjs'
import { PALETTES, derive, toOverrideMap } from './palettes.mjs'
import {
  DEFAULT_PAGE_VALUE,
  DEFAULT_TEXT_VALUE,
  PAGE_PRESETS,
  PAGE_RANGE,
  TEXT_PRESETS,
  TEXT_RANGE,
  measure,
  nearestPreset,
  resolveValue,
  tune,
  warmthFor,
} from './tune.mjs'

export {
  PALETTES,
  PAGE_PRESETS,
  PAGE_RANGE,
  TEXT_PRESETS,
  TEXT_RANGE,
  DEFAULT_PAGE_VALUE,
  DEFAULT_TEXT_VALUE,
  measure,
  nearestPreset,
  resolveValue,
  tune,
  warmthFor,
}
export { derive, toOverrideMap }

/**
 * Look a palette up by id.
 * @param id - `paper` | `sage` | `mist` | `ink` | `amber`.
 * @returns the palette record, or `undefined` when the id is unknown.
 */
export function resolvePalette(id) {
  return PALETTES.find((palette) => palette.id === id)
}

/**
 * Resolve a palette and apply both knobs, in one call.
 *
 * This is the whole library API most hosts need: pick a palette, pick two stops,
 * get a `{ token: { light, dark } }` map back.
 *
 * @param id - palette id.
 * @param stops - `{ page?, text? }` numeric values (or legacy stop ids); invalid input falls back to the defaults.
 * @returns `{ id, name, tagline, textWarmth, pairs }`, or `undefined` for an unknown id.
 */
export function buildPalette(id, stops) {
  const palette = resolvePalette(id)
  if (palette === undefined) return undefined
  return {
    id: palette.id,
    name: palette.name,
    tagline: palette.tagline,
    textWarmth: palette.textWarmth,
    pairs: tune(toOverrideMap(palette), palette, stops),
  }
}

/** Palette ids and display names, for a picker. */
export const PALETTE_LIST = PALETTES.map((palette) => ({
  id: palette.id,
  name: palette.name,
  tagline: palette.tagline,
  textWarmth: palette.textWarmth,
}))

/**
 * Ant Design 5/6 semantic tokens, mapped onto this package's alias tokens.
 *
 * Only the roles that carry a page's *temperature* are mapped: surfaces, text
 * tiers, borders, primary and link. Everything else (success/warning states,
 * control heights, radii) stays the host design system's business — an eye-care
 * palette should not restyle semantics it knows nothing about.
 */
export const ANTD_TOKEN_MAP = {
  colorBgBase: '--dsw-alias-bg-base',
  colorBgLayout: '--dsw-alias-bg-base',
  colorBgContainer: '--dsw-alias-bg-layer-2',
  colorBgElevated: '--dsw-alias-bg-layer-3',
  colorBgSpotlight: '--dsw-alias-bg-overlay',
  colorText: '--dsw-alias-label-primary',
  colorTextSecondary: '--dsw-alias-label-secondary',
  colorTextTertiary: '--dsw-alias-label-tertiary',
  colorTextQuaternary: '--dsw-alias-label-caption',
  colorBorder: '--dsw-alias-border-l2',
  colorBorderSecondary: '--dsw-alias-border-l1',
  colorSplit: '--dsw-alias-border-l1',
  colorPrimary: '--dsw-alias-brand-primary',
  colorLink: '--dsw-alias-link',
}

/**
 * Turn a tuned token map into a flat `{ property: value }` object.
 * @param pairs - `{ [token]: { light, dark } }`, straight from {@link tune}.
 * @param options - `{ mode, rename }`; `rename` maps a `--dsw-*` name to the host's name.
 * @returns `{ '--dsw-alias-bg-base': '#211F19', ... }` (or the renamed keys).
 */
export function toCssVars(pairs, options) {
  const mode = options?.mode === 'dark' ? 'dark' : 'light'
  const rename = typeof options?.rename === 'function' ? options.rename : (name) => name
  const vars = {}
  for (const [name, pair] of Object.entries(pairs)) {
    if (typeof pair?.[mode] === 'string') vars[rename(name)] = pair[mode]
  }
  return vars
}

/**
 * Render a tuned palette as CSS custom properties, one block per mode.
 *
 * @param pairs - `{ [token]: { light, dark } }`.
 * @param options - selectors, rename hook and whether to include the dark block.
 * @returns a stylesheet string, ready to be injected or written to a `.css` file.
 *
 * @example
 * toCssText(tuned, { lightSelector: ':root', darkSelector: 'html[data-theme="dark"]' })
 */
export function toCssText(pairs, options) {
  const lightSelector = options?.lightSelector ?? ':root'
  const darkSelector = options?.darkSelector ?? null
  const rename = options?.rename
  const block = (selector, mode) => {
    const body = Object.entries(toCssVars(pairs, { mode, rename }))
      .map(([name, value]) => `  ${name}: ${value};`)
      .join('\n')
    return `${selector} {\n${body}\n}`
  }
  const blocks = [block(lightSelector, 'light')]
  if (darkSelector !== null) blocks.push(block(darkSelector, 'dark'))
  return `${blocks.join('\n\n')}\n`
}

/**
 * Build an Ant Design theme object for `<ConfigProvider theme={...}>`.
 * @param pairs - `{ [token]: { light, dark } }`.
 * @param mode - which variant to emit.
 * @returns `{ token: { colorBgBase: '#...', ... } }`.
 */
export function toAntdTheme(pairs, mode) {
  const vars = toCssVars(pairs, { mode })
  const token = {}
  for (const [antdName, dswName] of Object.entries(ANTD_TOKEN_MAP)) {
    if (typeof vars[dswName] === 'string') token[antdName] = vars[dswName]
  }
  return { token }
}

/**
 * A palette preview payload: the five seed colours plus the measured contrast
 * each text stop lands on, so a host can label its picker honestly.
 * @param paletteId - palette id.
 * @returns `{ id, name, swatches, stops }` or `undefined`.
 */
export function palettePreview(paletteId) {
  const palette = resolvePalette(paletteId)
  if (palette === undefined) return undefined
  const pairs = toOverrideMap(palette)
  return {
    id: palette.id,
    name: palette.name,
    swatches: {
      light: [pairs['--dsw-alias-bg-base'].light, pairs['--dsw-alias-label-primary'].light, pairs['--dsw-alias-brand-primary'].light],
      dark: [pairs['--dsw-alias-bg-base'].dark, pairs['--dsw-alias-label-primary'].dark, pairs['--dsw-alias-brand-primary'].dark],
    },
    // Landmarks, not the whole scale: a picker can show five numbers without
    // pretending the slider only has five positions.
    stops: TEXT_PRESETS.map((preset) => {
      const measured = measure(pairs, palette, { text: preset.value })
      return {
        id: preset.id,
        label: preset.label,
        value: preset.value,
        contrast: { light: measured.light.primary, dark: measured.dark.primary },
      }
    }),
  }
}

/** Re-exported so a host can run its own contrast assertions without another dependency. */
export { contrast, luminance }
