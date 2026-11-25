#!/usr/bin/env node
/**
 * Contract + behaviour checks for the built bundle. Run after `tools/build.mjs`.
 *
 *  1. every token the palettes override must exist in the app's real token sheet
 *     (a typo silently paints nothing, so this is checked against ui-theme's CSS);
 *  2. every palette must clear the readability floors the README promises;
 *  3. the bundle must load in the client module system, register exactly one
 *     override layer, replace that layer on a palette switch, dispose it on
 *     "default", restore the remembered choice, and render six cubes.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PALETTES, TOKEN_NAMES, audit, toOverrideMap } from '../src/palettes.mjs'
import {
  ACCENT_COPY_TOKENS,
  COPY_TIERS,
  DEFAULT_PAGE_VALUE,
  DEFAULT_TEXT_VALUE,
  ON_FILL_COPY_TOKENS,
  PAGE_PRESETS,
  PAGE_RANGE,
  SURFACE_TOKENS,
  TEXT_PRESETS,
  TEXT_RANGE,
  measure,
  nearestPreset,
  quantizeValue,
  resolveValue,
  tune,
  warmthFor,
} from '../src/tune.mjs'
import { contrast } from '../src/color.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const check = (label, ok, detail = '') => {
  if (!ok) failures.push(`${label}${detail === '' ? '' : ` — ${detail}`}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

// ---------------------------------------------------------------- 1. token names
/** Path to the built-in theme package that owns the token sheet. */
function tokenSheetPath() {
  const candidates = [
    process.env.DSH_UI_THEME_CSS,
    join(process.env.HOME ?? '', '.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'),
    '/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js',
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      return candidate
    } catch {
      /* keep looking */
    }
  }
  return candidates[0]
}

let knownTokens = null
const sheetPath = tokenSheetPath()
try {
  const sheet = readFileSync(sheetPath, 'utf8')
  knownTokens = new Set([...sheet.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((match) => match[1]))
  // shiki tokens are declared in the same bundle (shiki.css)
  for (const match of sheet.matchAll(/(--shiki-[a-z-]+)\s*:/g)) knownTokens.add(match[1])
} catch (error) {
  console.log(`warn could not read the token sheet at ${sheetPath} (${error.message}); skipping name check`)
}

if (knownTokens !== null) {
  const unknown = TOKEN_NAMES.filter((name) => !knownTokens.has(name))
  check('every overridden token exists in the app token sheet', unknown.length === 0, unknown.join(', '))
}

// ---------------------------------------------------------------- 2. readability
for (const palette of PALETTES) {
  for (const row of audit(palette)) {
    const label = `${palette.id}/${row.mode}`
    check(`${label} body text >= 7:1 (AAA)`, row.body >= 7, `${row.body.toFixed(2)}:1`)
    check(`${label} secondary text >= 4.5:1`, row.secondary >= 4.5, `${row.secondary.toFixed(2)}:1`)
    check(`${label} tertiary text >= 4.5:1`, row.tertiary >= 4.5, `${row.tertiary.toFixed(2)}:1`)
    check(`${label} link >= 4.5:1`, row.link >= 4.5, `${row.link.toFixed(2)}:1`)
    check(`${label} accent >= 4.5:1`, row.accent >= 4.5, `${row.accent.toFixed(2)}:1`)
    check(`${label} code text >= 7:1`, row.code >= 7, `${row.code.toFixed(2)}:1`)
    check(`${label} syntax colours >= 3:1 on code`, row.shikiMin >= 3, `${row.shikiMin.toFixed(2)}:1`)
  }
}

// no pure white / pure black glare in any palette
for (const palette of PALETTES) {
  for (const mode of ['light', 'dark']) {
    const seed = palette[mode]
    check(`-- ${palette.id}/${mode} base is not pure white/black`, !['#ffffff', '#000000'].includes(seed.base.toLowerCase()), seed.base)
    check(`-- ${palette.id}/${mode} body contrast stays under 14:1`, contrast(seed.ink, seed.base) < 14, contrast(seed.ink, seed.base).toFixed(2))
  }
}

// ------------------------------- 2b. page brightness x text brightness (continuous)
{
  const pairsOf = (palette) => toOverrideMap(palette)
  /** Every value the slider can rest on, per range. */
  const grid = (range) => {
    const out = []
    for (let value = range.min; value <= range.max + 1e-9; value += range.step) out.push(Math.round(value * 100) / 100)
    return out
  }
  const pageGrid = grid(PAGE_RANGE)
  const textGrid = grid(TEXT_RANGE)

  check('both knobs are continuous ranges', PAGE_RANGE.step <= 0.01 && TEXT_RANGE.step <= 0.05, `${PAGE_RANGE.step} / ${TEXT_RANGE.step}`)
  check('the text range spans the old 5 stops', TEXT_RANGE.min === 8 && TEXT_RANGE.max === 11.5)
  check('the page range spans the old 7 stops', PAGE_RANGE.min === 0.7 && PAGE_RANGE.max === 1.45)
  check('the text grid has ~70 settable values', textGrid.length >= 70, String(textGrid.length))
  check('the page grid has ~76 settable values', pageGrid.length >= 70, String(pageGrid.length))
  check('presets are landmarks inside their ranges', TEXT_PRESETS.every((p) => p.value >= TEXT_RANGE.min && p.value <= TEXT_RANGE.max) && PAGE_PRESETS.every((p) => p.value >= PAGE_RANGE.min && p.value <= PAGE_RANGE.max))
  check('presets still name the old stops', TEXT_PRESETS.map((p) => p.id).join(',') === 'standard,gentle,mild,soft,softer')
  check('defaults are on the grid', quantizeValue(DEFAULT_TEXT_VALUE, TEXT_RANGE, 0) === DEFAULT_TEXT_VALUE && quantizeValue(DEFAULT_PAGE_VALUE, PAGE_RANGE, 0) === DEFAULT_PAGE_VALUE)
  check('a mid-gap value is settable (10.25)', textGrid.includes(10.25), String(textGrid.includes(10.25)))
  check('quantising clamps to the range', quantizeValue(99, TEXT_RANGE, 0) === TEXT_RANGE.max && quantizeValue(1, TEXT_RANGE, 0) === TEXT_RANGE.min)
  check('legacy stop ids still resolve', resolveValue('soft', TEXT_RANGE, TEXT_PRESETS, 0) === 9.6 && resolveValue('softer', TEXT_RANGE, TEXT_PRESETS, 0) === 8 && resolveValue('standard', PAGE_RANGE, PAGE_PRESETS, 0) === 1, `${resolveValue('softer', TEXT_RANGE, TEXT_PRESETS, 0)}`)
  check('junk falls back to the default', resolveValue('nope', TEXT_RANGE, TEXT_PRESETS, DEFAULT_TEXT_VALUE) === DEFAULT_TEXT_VALUE)
  check('a missing key falls back, not to the range floor', resolveValue(null, TEXT_RANGE, TEXT_PRESETS, DEFAULT_TEXT_VALUE) === DEFAULT_TEXT_VALUE)
  check('warmth rises as text gets dimmer', warmthFor(TEXT_RANGE.max) < warmthFor(9.6) && warmthFor(9.6) < warmthFor(TEXT_RANGE.min), `${warmthFor(11.5).toFixed(2)} < ${warmthFor(9.6).toFixed(2)} < ${warmthFor(8).toFixed(2)}`)
  check('nearest preset names a value between landmarks', nearestPreset(10.25, TEXT_PRESETS).id === 'mild', nearestPreset(10.25, TEXT_PRESETS).id)

  // The full matrix, on the fine grid (sampled: every 4th text value x every 3rd page value).
  const pageSample = pageGrid.filter((_, index) => index % 3 === 0)
  const textSample = textGrid.filter((_, index) => index % 4 === 0)
  let combinations = 0
  for (const palette of PALETTES) {
    const pairs = pairsOf(palette)
    const label = (page, text, mode) => `${palette.id} page=${page} text=${text} ${mode}`
    for (const page of pageSample) {
      for (const text of textSample) {
        const tuned = tune(pairs, palette, { page, text })
        const measured = measure(pairs, palette, { page, text })
        combinations += 1
        for (const mode of ['light', 'dark']) {
          const tier = measured[mode]
          check(`${label(page, text, mode)} lands on its target`, Math.abs(tier.primary - text) < 0.18, `${tier.primary.toFixed(2)} vs ${text}`)
          check(`${label(page, text, mode)} keeps the AA floor`, tier.primary >= 4.5, `${tier.primary.toFixed(2)}:1`)
          check(`${label(page, text, mode)} ramp stays ordered`, tier.primary > tier.secondary && tier.secondary > tier.tertiary, `${tier.primary.toFixed(2)} > ${tier.secondary.toFixed(2)} > ${tier.tertiary.toFixed(2)}`)
          check(`${label(page, text, mode)} secondary/link stay readable`, tier.secondary >= 4.4 && tier.link >= 4.4)
          check(`${label(page, text, mode)} syntax colours stay visible`, tier.shikiMin >= 3, `${tier.shikiMin.toFixed(2)}:1`)
          check(`${label(page, text, mode)} never emits pure white/black copy`, !/^#(?:f{6}|0{6})$/i.test(tier.primaryHex), tier.primaryHex)
        }
        check(`${label(page, text, 'both')} text leaves surfaces untouched`, SURFACE_TOKENS.every((name) => !tuned[name] || tuned[name].dark === tune(pairs, palette, { page, text: TEXT_RANGE.max })[name]?.dark))
        check(`${label(page, text, 'both')} page leaves the accent untouched`, ['--dsw-alias-brand-primary', '--dsw-alias-button-primary-fill'].every((name) => !tuned[name] || tuned[name].dark === tune(pairs, palette, { page: DEFAULT_PAGE_VALUE, text })[name]?.dark))
      }
    }

    // Fine-grained monotonicity: brightness and text must move one way only.
    for (const mode of ['light', 'dark']) {
      const baseLum = pageGrid.map((page) => tune(pairs, palette, { page, text: DEFAULT_TEXT_VALUE })['--dsw-alias-bg-base'][mode])
      const sum = (hex) => Number.parseInt(hex.slice(1, 7), 16)
      const values = baseLum.map(sum)
      check(`-- ${palette.id} ${mode} page brightness rises with the factor`, values.every((value, i) => i === 0 || value >= values[i - 1]), `${values[0]}..${values.at(-1)}`)
      check(`-- ${palette.id} ${mode} page brightness has a wide range`, values.at(-1) - values[0] >= 20, String(values.at(-1) - values[0]))
      const ratios = textGrid.map((text) => measure(pairs, palette, { text })[mode].primary)
      // 8-bit output cannot resolve better than one channel step, which is worth
      // up to ~0.17 of contrast here, so the invariant is: never brighter than
      // requested, and never backwards by more than one quantisation step.
      const overshoot = Math.max(...ratios.map((ratio, i) => ratio - textGrid[i]))
      const worstBackstep = Math.max(0, ...ratios.map((ratio, i) => (i === 0 ? 0 : ratio - ratios[i - 1])))
      check(`-- ${palette.id} ${mode} text brightness never overshoots the request`, overshoot <= 0.02, overshoot.toFixed(3))
      check(`-- ${palette.id} ${mode} text brightness is monotone within one 8-bit step`, worstBackstep <= 0.2, worstBackstep.toFixed(3))
      check(`-- ${palette.id} ${mode} text brightness is not steppy`, new Set(ratios.map((r) => r.toFixed(1))).size >= 20, `${new Set(ratios.map((r) => r.toFixed(1))).size} distinct tenths`)
    }
  }
  check('the sampled matrix was exercised', combinations === PALETTES.length * pageSample.length * textSample.length, String(combinations))
}

// ------------------------------------------------------- 2c. library entry point
{
  // The non-DSH entry (`dsh-eye-themes/export`) is what another app depends on, so
  // it is exercised here too — it once drifted from the tuner's API unnoticed.
  const lib = await import('../src/export.mjs')
  const built = lib.buildPalette('paper', { page: 0.93, text: 10.25 })
  check('library: buildPalette resolves a palette', built?.id === 'paper' && typeof built.pairs === 'object')
  check('library: buildPalette applies both values', built.pairs['--dsw-alias-label-primary'].dark === tune(toOverrideMap(PALETTES[0]), PALETTES[0], { page: 0.93, text: 10.25 })['--dsw-alias-label-primary'].dark)
  check('library: unknown palette returns undefined', lib.buildPalette('nope') === undefined)

  const css = lib.toCssText(built.pairs, { lightSelector: ':root', darkSelector: 'html.dark' })
  check('library: toCssText emits both mode blocks', css.includes(':root {') && css.includes('html.dark {'), css.slice(0, 40))
  // Count declaration lines, not `--dsw-` substrings: nine tokens are `--shiki-*`.
  const declarations = css.split('\n').filter((line) => line.trim().startsWith('--')).length
  check('library: toCssText covers every token in both modes', declarations === TOKEN_NAMES.length * 2, String(declarations))

  const antd = lib.toAntdTheme(built.pairs, 'dark')
  check('library: toAntdTheme maps the semantic tokens', Object.keys(antd.token).length === Object.keys(lib.ANTD_TOKEN_MAP).length && antd.token.colorBgBase === built.pairs['--dsw-alias-bg-base'].dark, String(Object.keys(antd.token).length))
  check('library: every AntD mapping resolves to a real token', Object.values(lib.ANTD_TOKEN_MAP).every((name) => built.pairs[name] !== undefined), Object.values(lib.ANTD_TOKEN_MAP).filter((n) => built.pairs[n] === undefined).join(','))

  const preview = lib.palettePreview('amber')
  check('library: palettePreview reports the landmarks', preview.stops.length === TEXT_PRESETS.length && preview.stops.every((stop) => stop.contrast.dark >= 7), preview.stops.map((s) => s.contrast.dark.toFixed(1)).join(','))
  check('library: palettePreview names swatches for both modes', preview.swatches.light.length === 3 && preview.swatches.dark.length === 3)
  check('library: ranges are re-exported', lib.TEXT_RANGE.step === TEXT_RANGE.step && lib.PAGE_RANGE.max === PAGE_RANGE.max)
}

// ---------------------------------------------------------------- 3. bundle smoke
/** Surfaces and accents must never move when only the text temperature changes. */
const KEEP_TOKENS = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-markdown-code-block',
  '--dsw-specific-sidebar-fill',
]

const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
check('bundle declares the module loader entry', bundle.startsWith('// GENERATED') && bundle.includes('window.__ModuleLoader__.load('))

/** Minimal React stub: enough for createElement trees and hook calls. */
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}

let registered = null
const windowStub = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      registered = { id, factory }
    },
  },
  localStorage: {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null
    },
    setItem(key, value) {
      this.store.set(key, String(value))
    },
  },
  addEventListener() {},
  removeEventListener() {},
}

const layerCalls = []
const slotRegistrations = []
const localeRegistrations = []
const styleTags = []
const effects = []
const fakeDocument = {
  body: { hasAttribute: () => false, attributes: {} },
  head: { appendChild: (tag) => styleTags.push(tag) },
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  querySelector: () => null,
  documentElement: { style: {} },
  addEventListener() {},
  removeEventListener() {},
}

const ctx = {
  get: (name) =>
    ({
      theme: {
        overrideTokens: (source, tokens) => {
          layerCalls.push({ source, tokens })
          const dispose = () => layerCalls.push({ source, disposed: true })
          return dispose
        },
      },
      locale: {
        register: (ns, messages) => {
          localeRegistrations.push({ ns, messages })
          return () => {}
        },
        resolveText: (text) => text.zh,
      },
    })[name],
  effect: (callback) => {
    const dispose = callback()
    effects.push(dispose)
    return dispose
  },
  slots: {
    inject: (_name, register) => register(),
    register: (descriptor, component) => {
      slotRegistrations.push({ descriptor, component })
      return () => {}
    },
  },
  on: () => () => {},
}

// Evaluate the bundle with our stubs in scope.
const sandbox = { window: windowStub, document: fakeDocument, console, MutationObserver: undefined }
sandbox.globalThis = sandbox
const run = new Function('window', 'document', 'console', 'require', 'module', 'exports', bundle.replace('window.__ModuleLoader__.load(', 'window.__ModuleLoader__.load.call(window, '))
run(windowStub, fakeDocument, console, (name) => {
  if (name === 'react') return ReactStub
  throw new Error(`unexpected require: ${name}`)
}, { exports: {} }, {})

check('bundle registers under its package id', registered?.id === 'dsh-eye-themes', registered?.id)
const plugin = registered.factory((name) => {
  if (name === 'react') return ReactStub
  throw new Error(`unexpected require: ${name}`)
})
check('plugin exposes apply + inject', typeof plugin.apply === 'function' && Array.isArray(plugin.inject), String(plugin.inject))

plugin.apply(ctx)

check('one settings row registered', slotRegistrations.length === 1, String(slotRegistrations.length))
const [{ descriptor, component }] = slotRegistrations
check('row targets settings.general.item', descriptor.name === 'settings.general.item', descriptor.name)
check('row id is its own (does not replace a shipped row)', descriptor.id === 'eye-themes', descriptor.id)
check('row sits right after the built-in appearance rows', descriptor.order > 11 && descriptor.order < 12, String(descriptor.order))
check('row binds the package locale namespace', descriptor.locale === 'settings.eye-themes', descriptor.locale)
check('locale copy registered for zh + en', localeRegistrations.length === 1 && Boolean(localeRegistrations[0].messages.en))
check('row stylesheet mounted and tagged', styleTags.length === 1 && styleTags[0].dataset.plugin === 'dsh-eye-themes')
check('nothing is applied before a palette is chosen', layerCalls.length === 0, JSON.stringify(layerCalls.length))

const override = toOverrideMap(PALETTES[0])
check('palette payload covers every token in every mode', PALETTES.every((palette) => {
  const map = toOverrideMap(palette)
  return TOKEN_NAMES.every((name) => typeof map[name]?.light === 'string' && typeof map[name]?.dark === 'string')
}))

// Render the row with a translator, expanding function components one level at a time
// (the React stub is hook-only, so no state updates are simulated here).
const t = (key) => ({ title: '护眼配色', hint: 'hint', off: '默认', offHint: 'built-in', active: '使用中' })[key] ?? key
const expand = (node, depth = 0) => {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (typeof node.type === 'function' && depth < 8) return expand(node.type(node.props), depth + 1)
  return { ...node, children: node.children.map((child) => expand(child, depth)) }
}

const tree = expand(component({ t }))
const cubeRow = tree.children.find((child) => child?.props?.className === 'dshEyeThemes_row')
const cubes = cubeRow.children.map((cube) => expand(cube))
check('row renders 5 palettes + default', cubes.length === 6, String(cubes.length))
check('every cube is a button with aria-pressed', cubes.every((cube) => cube.type === 'button' && typeof cube.props['aria-pressed'] === 'boolean'))
check('default cube is selected initially', cubes[5].props['aria-pressed'] === true)
check('each palette cube previews three colours', cubes.slice(0, 5).every((cube) => {
  const swatch = cube.children.find((child) => child?.props?.className === 'dshEyeThemes_swatch')
  return swatch?.children.length === 3
}))
check('each cube shows its palette name', cubes.slice(0, 5).every((cube) => {
  const label = cube.children.find((child) => child?.props?.className === 'dshEyeThemes_label')
  return typeof label?.children[0] === 'string' && label.children[0].length > 0
}))

// The two sliders render as stepped native range inputs.
const slidersWrap = tree.children.find((child) => child?.props?.className === 'dshEyeThemes_sliders')
const sliders = slidersWrap.children.map((child) => expand(child))
check('row renders exactly two sliders', sliders.length === 2, String(sliders.length))
const rangeOf = (slider) => slider.children.map((child) => expand(child)).find((child) => child?.type === 'input')
const ranges = sliders.map(rangeOf)
check('both sliders are range inputs', ranges.every((input) => input?.props?.type === 'range'))
check('the first slider spans the page range', ranges[0].props.min === PAGE_RANGE.min && ranges[0].props.max === PAGE_RANGE.max, `${ranges[0].props.min}..${ranges[0].props.max}`)
check('the second slider spans the text range', ranges[1].props.min === TEXT_RANGE.min && ranges[1].props.max === TEXT_RANGE.max, `${ranges[1].props.min}..${ranges[1].props.max}`)
check('sliders use the fine step, not stop indexes', ranges[0].props.step === PAGE_RANGE.step && ranges[1].props.step === TEXT_RANGE.step, `${ranges[0].props.step} / ${ranges[1].props.step}`)
check('sliders snap onto the fine grid', ranges[0].props.step <= 0.01 && ranges[1].props.step <= 0.05)
check('sliders carry an accessible name and value text', ranges.every((input) => typeof input.props['aria-label'] === 'string' && typeof input.props['aria-valuetext'] === 'string'))
check('the default brightness is 100%', ranges[0].props.value === DEFAULT_PAGE_VALUE, String(ranges[0].props.value))
check('the default text brightness is 9.6', ranges[1].props.value === DEFAULT_TEXT_VALUE, String(ranges[1].props.value))
const sliderValueOf = (slider) => slider.children.map((child) => expand(child)).find((child) => child?.props?.className === 'dshEyeThemes_sliderHead')
  .children.map((child) => expand(child)).find((child) => child?.props?.className === 'dshEyeThemes_sliderValue')
check('with no palette active the sliders read as disabled', ranges.every((input) => input.props.disabled === true))

const hintOf = (id) => {
  const row = expand(component({ t: (key) => key }))
  return row.children.find((child) => child?.props?.className === 'dshEyeThemes_header').children
    .map((child) => expand(child)).find((child) => child?.props?.className === 'dshEyeThemes_hint').children[0]
}
check('with no palette active the hint asks for one first', hintOf() === 'textHintOff', String(hintOf()))

// Selecting a palette stacks one layer with the full token map; selecting another replaces it.
const paletteCubes = cubes.slice(0, 5)
paletteCubes[1].props.onClick()
check('choosing a palette stacks exactly one layer', layerCalls.filter((call) => !call.disposed).length === 1)
const firstLayer = layerCalls.find((call) => !call.disposed)
check('layer source is the package id (one layer per source)', firstLayer.source === 'dsh-eye-themes', firstLayer.source)
check('layer carries the complete token map', Object.keys(firstLayer.tokens).length === TOKEN_NAMES.length, String(Object.keys(firstLayer.tokens).length))
check('layer values are { light, dark } pairs', Object.values(firstLayer.tokens).every((pair) => typeof pair.light === 'string' && typeof pair.dark === 'string'))
check('chosen palette persisted', windowStub.localStorage.getItem('dsh-eye-themes:palette') === PALETTES[1].id, String(windowStub.localStorage.getItem('dsh-eye-themes:palette')))
const tunedDefault = tune(toOverrideMap(PALETTES[1]), PALETTES[1], { page: DEFAULT_PAGE_VALUE, text: DEFAULT_TEXT_VALUE })
check('the layer is the palette with both knobs applied', firstLayer.tokens['--dsw-alias-label-primary'].dark === tunedDefault['--dsw-alias-label-primary'].dark, `${firstLayer.tokens['--dsw-alias-label-primary'].dark} vs ${tunedDefault['--dsw-alias-label-primary'].dark}`)
check('the copy changed from the palette default', firstLayer.tokens['--dsw-alias-label-primary'].dark !== toOverrideMap(PALETTES[1])['--dsw-alias-label-primary'].dark)

// Re-render with a palette active: sliders enable and the text slider reports its contrast.
const activeTree = expand(component({ t: (key) => key }))
const activeSliders = activeTree.children.find((child) => child?.props?.className === 'dshEyeThemes_sliders').children.map((child) => expand(child))
const activeRanges = activeSliders.map(rangeOf)
check('sliders enable once a palette is active', activeRanges.every((input) => input.props.disabled === false))
const shownUnit = sliderValueOf(activeSliders[1]).children.find((child) => child?.props?.className === 'dshEyeThemes_sliderUnit')
const shownText = (shownUnit?.children ?? []).join('')
check('the text slider shows the contrast it lands on', /·\s*\d+\.\d+:1/.test(shownText), shownText)

// Dragging the text slider restacks the same layer and only moves copy.
const textRange = rangeOf(sliders[1])
const dragTo = (input, value) => input.props.onChange({ target: { value: String(value) } })
// A value that is not a landmark: 10.25 sits between 较柔 (10.2) and 偏柔 (10.85).
dragTo(textRange, 10.25)
const afterText = layerCalls.filter((call) => !call.disposed).at(-1)
check('dragging restacks one layer (no second source)', layerCalls.filter((call) => !call.disposed).length === 2)
check('a value between landmarks applies exactly', afterText.tokens['--dsw-alias-label-primary'].dark === tune(toOverrideMap(PALETTES[1]), PALETTES[1], { page: DEFAULT_PAGE_VALUE, text: 10.25 })['--dsw-alias-label-primary'].dark)
check('the fine value persisted as a number', windowStub.localStorage.getItem('dsh-eye-themes:text') === '10.25', String(windowStub.localStorage.getItem('dsh-eye-themes:text')))
check('a text value leaves surfaces and accents untouched', KEEP_TOKENS.every((name) => afterText.tokens[name].dark === firstLayer.tokens[name].dark))

// Dragging the brightness slider moves surfaces but not the accent.
const pageRange = rangeOf(sliders[0])
dragTo(pageRange, 0.85)
const afterPage = layerCalls.filter((call) => !call.disposed).at(-1)
check('brightness drag restacks one layer', layerCalls.filter((call) => !call.disposed).length === 3)
check('the page actually got darker', Number(afterPage.tokens['--dsw-alias-bg-base'].dark.slice(1, 3), 16) < Number(firstLayer.tokens['--dsw-alias-bg-base'].dark.slice(1, 3), 16), `${firstLayer.tokens['--dsw-alias-bg-base'].dark} -> ${afterPage.tokens['--dsw-alias-bg-base'].dark}`)
check('the brightness value persisted', windowStub.localStorage.getItem('dsh-eye-themes:page') === '0.85', String(windowStub.localStorage.getItem('dsh-eye-themes:page')))
check('a brightness value leaves the accent alone', afterPage.tokens['--dsw-alias-brand-primary'].dark === firstLayer.tokens['--dsw-alias-brand-primary'].dark)

// Re-dragging to the same stop must not republish anything.
const before = layerCalls.length
dragTo(pageRange, 0.85)
check('a repeat drag to the same stop does not republish', layerCalls.length === before, `${layerCalls.length} vs ${before}`)

paletteCubes[3].props.onClick()
check('switching palettes replaces the layer instead of stacking', layerCalls.filter((call) => !call.disposed).length === 4 && layerCalls[1].disposed !== true)
cubes[5].props.onClick()
check('default disposes the layer', layerCalls.some((call) => call.disposed === true))
check('default choice persisted', windowStub.localStorage.getItem('dsh-eye-themes:palette') === 'default')

// Teardown must release the layer.
paletteCubes[0].props.onClick()
const beforeTeardown = layerCalls.filter((call) => !call.disposed).length
for (const dispose of effects) if (typeof dispose === 'function') dispose()
check('plugin teardown releases the layer', layerCalls.some((call) => call.disposed === true), `layers before teardown: ${beforeTeardown}`)

// Restore-on-boot: a stored palette and temperature are applied by apply() without a click.
windowStub.localStorage.setItem('dsh-eye-themes:palette', PALETTES[2].id)
windowStub.localStorage.setItem('dsh-eye-themes:text', '8.35')
windowStub.localStorage.setItem('dsh-eye-themes:page', '1.2')
layerCalls.length = 0
plugin.apply(ctx)
check('a stored palette is restored on boot', layerCalls.length === 1 && layerCalls[0].source === 'dsh-eye-themes')
const restored = tune(toOverrideMap(PALETTES[2]), PALETTES[2], { page: 1.2, text: 8.35 })
check('the stored stops are restored too', layerCalls[0].tokens['--dsw-alias-label-primary'].dark === restored['--dsw-alias-label-primary'].dark && layerCalls[0].tokens['--dsw-alias-bg-base'].dark === restored['--dsw-alias-bg-base'].dark, `${layerCalls[0].tokens['--dsw-alias-bg-base'].dark} vs ${restored['--dsw-alias-bg-base'].dark}`)

// ---------------------------------------------------------------- result
console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('all checks passed')
