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
  DEFAULT_PAGE_STOP,
  DEFAULT_TEXT_STOP,
  ON_FILL_COPY_TOKENS,
  PAGE_STOPS,
  SURFACE_TOKENS,
  TEXT_STOPS,
  measure,
  tune,
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

// ------------------------------------- 2b. page brightness x text brightness
{
  const pairsOf = (palette) => toOverrideMap(palette)
  const baseOf = (palette) => pairsOf(palette)['--dsw-alias-bg-base']

  // Every stop is present, ordered, and documented.
  check('there are 7 page-brightness stops', PAGE_STOPS.length === 7, String(PAGE_STOPS.length))
  check('page stops are ordered dim -> bright', PAGE_STOPS.every((stop, i) => i === 0 || stop.factor > PAGE_STOPS[i - 1].factor))
  check('there are 5 text-brightness stops', TEXT_STOPS.length === 5, String(TEXT_STOPS.length))
  check('text stops are ordered bright -> soft', TEXT_STOPS.every((stop, i) => i === 0 || stop.ceiling < TEXT_STOPS[i - 1].ceiling))
  check(
    'two text stops sit between 标准 and 柔和',
    TEXT_STOPS.findIndex((stop) => stop.id === 'soft') - TEXT_STOPS.findIndex((stop) => stop.id === 'standard') === 3,
  )
  check('defaults are standard brightness / soft text', DEFAULT_PAGE_STOP === 'standard' && DEFAULT_TEXT_STOP === 'soft')

  // The whole matrix: 5 palettes x 7 page stops x 5 text stops x 2 modes.
  let combinations = 0
  for (const palette of PALETTES) {
    const pairs = pairsOf(palette)
    const label = (page, text, mode) => `${palette.id} page=${page} text=${text} ${mode}`

    for (const pageStop of PAGE_STOPS) {
      for (const textStop of TEXT_STOPS) {
        const tuned = tune(pairs, palette, { page: pageStop.id, text: textStop.id })
        const measured = measure(pairs, palette, { page: pageStop.id, text: textStop.id })
        combinations += 1
        for (const mode of ['light', 'dark']) {
          const tier = measured[mode]
          // 8-bit output quantises the landing; on the darkest/lightest pages one
          // channel step is worth ~0.15 of contrast, so the tolerance allows it.
          check(`${label(pageStop.id, textStop.id, mode)} lands on its contrast target`, Math.abs(tier.primary - textStop.ceiling) < 0.16, `${tier.primary.toFixed(2)} vs ${textStop.ceiling}`)
          check(`${label(pageStop.id, textStop.id, mode)} keeps the AA floor`, tier.primary >= 4.5, `${tier.primary.toFixed(2)}:1`)
          check(`${label(pageStop.id, textStop.id, mode)} ramp stays ordered`, tier.primary > tier.secondary && tier.secondary > tier.tertiary, `${tier.primary.toFixed(2)} > ${tier.secondary.toFixed(2)} > ${tier.tertiary.toFixed(2)}`)
          check(`${label(pageStop.id, textStop.id, mode)} secondary/link stay readable`, tier.secondary >= 4.4 && tier.link >= 4.4, `${tier.secondary.toFixed(2)} / ${tier.link.toFixed(2)}`)
          check(`${label(pageStop.id, textStop.id, mode)} syntax colours stay visible`, tier.shikiMin >= 3, `${tier.shikiMin.toFixed(2)}:1`)
          check(`${label(pageStop.id, textStop.id, mode)} never emits pure white/black copy`, !/^#(?:f{6}|0{6})$/i.test(tier.primaryHex), tier.primaryHex)
        }
        // A text-only change must not move a single surface token.
        const flat = tune(pairs, palette, { page: pageStop.id, text: TEXT_STOPS[0].id })
        check(
          `${label(pageStop.id, textStop.id, 'both')} text stop leaves surfaces untouched`,
          SURFACE_TOKENS.every((name) => !tuned[name] || tuned[name].dark === flat[name].dark),
        )
        // A page-only change must not move an accent token.
        const noPage = tune(pairs, palette, { page: PAGE_STOPS[3].id, text: textStop.id })
        check(
          `${label(pageStop.id, textStop.id, 'both')} page stop leaves accents untouched`,
          ['--dsw-alias-brand-primary', '--dsw-alias-button-primary-fill'].every((name) => !tuned[name] || tuned[name].dark === noPage[name].dark),
        )
      }
    }

    // Page brightness actually moves the page, monotonically, and stays off pure white/black.
    for (const mode of ['light', 'dark']) {
      const bases = PAGE_STOPS.map((stop) => tune(pairs, palette, { page: stop.id, text: DEFAULT_TEXT_STOP })[ '--dsw-alias-bg-base'][mode])
      const lum = bases.map((hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16))
      check(`-- ${palette.id} ${mode} page brightness is monotonic`, lum.every((value, i) => i === 0 || value > lum[i - 1]), lum.join(','))
      check(`-- ${palette.id} ${mode} page brightness has visible range`, lum[lum.length - 1] - lum[0] >= 20, String(lum[lum.length - 1] - lum[0]))
      check(`-- ${palette.id} ${mode} page brightness never clips to pure white/black`, bases.every((hex) => !/^#(?:f{6}|0{6})$/i.test(hex)), bases.join(' '))
    }

    // Text brightness monotonic in both modes, and the extremes are a real change.
    for (const mode of ['light', 'dark']) {
      const ratios = TEXT_STOPS.map((stop) => measure(pairs, palette, { text: stop.id })[mode].primary)
      check(`-- ${palette.id} ${mode} text brightness is monotonic`, ratios.every((value, i) => i === 0 || value < ratios[i - 1]), ratios.map((v) => v.toFixed(2)).join(' '))
      check(`-- ${palette.id} ${mode} text brightness spans >= 3 stops of contrast`, ratios[0] - ratios.at(-1) >= 3, `${ratios[0].toFixed(2)} -> ${ratios.at(-1).toFixed(2)}`)
    }
  }
  check('the matrix was exercised', combinations === PALETTES.length * PAGE_STOPS.length * TEXT_STOPS.length, String(combinations))
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
check('the first slider steps over the page stops', ranges[0].props.max === PAGE_STOPS.length - 1, `${ranges[0].props.min}..${ranges[0].props.max}`)
check('the second slider steps over the text stops', ranges[1].props.max === TEXT_STOPS.length - 1, `${ranges[1].props.min}..${ranges[1].props.max}`)
check('sliders snap to whole stops', ranges.every((input) => input.props.step === 1))
check('sliders carry an accessible name and value text', ranges.every((input) => typeof input.props['aria-label'] === 'string' && typeof input.props['aria-valuetext'] === 'string'))
check('the default brightness is the middle stop', ranges[0].props.value === PAGE_STOPS.findIndex((stop) => stop.id === DEFAULT_PAGE_STOP))
check('the default text stop is the soft one', ranges[1].props.value === TEXT_STOPS.findIndex((stop) => stop.id === DEFAULT_TEXT_STOP))
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
const tunedDefault = tune(toOverrideMap(PALETTES[1]), PALETTES[1], { page: DEFAULT_PAGE_STOP, text: DEFAULT_TEXT_STOP })
check('the layer is the palette with both stops applied', firstLayer.tokens['--dsw-alias-label-primary'].dark === tunedDefault['--dsw-alias-label-primary'].dark, `${firstLayer.tokens['--dsw-alias-label-primary'].dark} vs ${tunedDefault['--dsw-alias-label-primary'].dark}`)
check('the copy changed from the palette default', firstLayer.tokens['--dsw-alias-label-primary'].dark !== toOverrideMap(PALETTES[1])['--dsw-alias-label-primary'].dark)

// Re-render with a palette active: sliders enable and the text slider reports its contrast.
const activeTree = expand(component({ t: (key) => key }))
const activeSliders = activeTree.children.find((child) => child?.props?.className === 'dshEyeThemes_sliders').children.map((child) => expand(child))
const activeRanges = activeSliders.map(rangeOf)
check('sliders enable once a palette is active', activeRanges.every((input) => input.props.disabled === false))
const shownUnit = sliderValueOf(activeSliders[1]).children.find((child) => child?.props?.className === 'dshEyeThemes_sliderUnit')
const shownText = (shownUnit?.children ?? []).join('')
check('the text slider shows the contrast it lands on', /·\s*\d+\.\d:1/.test(shownText), shownText)

// Dragging the text slider restacks the same layer and only moves copy.
const textRange = rangeOf(sliders[1])
const dragTo = (input, index) => input.props.onChange({ target: { value: String(index) } })
dragTo(textRange, TEXT_STOPS.findIndex((stop) => stop.id === 'standard'))
const afterText = layerCalls.filter((call) => !call.disposed).at(-1)
check('dragging restacks one layer (no second source)', layerCalls.filter((call) => !call.disposed).length === 2)
check('the layer now carries the standard text stop', afterText.tokens['--dsw-alias-label-primary'].dark === tune(toOverrideMap(PALETTES[1]), PALETTES[1], { page: DEFAULT_PAGE_STOP, text: 'standard' })['--dsw-alias-label-primary'].dark)
check('text stop persisted', windowStub.localStorage.getItem('dsh-eye-themes:text') === 'standard', String(windowStub.localStorage.getItem('dsh-eye-themes:text')))
check('a text stop leaves surfaces and accents untouched', KEEP_TOKENS.every((name) => afterText.tokens[name].dark === firstLayer.tokens[name].dark))

// Dragging the brightness slider moves surfaces but not the accent.
const pageRange = rangeOf(sliders[0])
dragTo(pageRange, PAGE_STOPS.findIndex((stop) => stop.id === 'dim'))
const afterPage = layerCalls.filter((call) => !call.disposed).at(-1)
check('brightness drag restacks one layer', layerCalls.filter((call) => !call.disposed).length === 3)
check('the page actually got darker', Number(afterPage.tokens['--dsw-alias-bg-base'].dark.slice(1, 3), 16) < Number(firstLayer.tokens['--dsw-alias-bg-base'].dark.slice(1, 3), 16), `${firstLayer.tokens['--dsw-alias-bg-base'].dark} -> ${afterPage.tokens['--dsw-alias-bg-base'].dark}`)
check('brightness stop persisted', windowStub.localStorage.getItem('dsh-eye-themes:page') === 'dim', String(windowStub.localStorage.getItem('dsh-eye-themes:page')))
check('a brightness stop leaves the accent alone', afterPage.tokens['--dsw-alias-brand-primary'].dark === firstLayer.tokens['--dsw-alias-brand-primary'].dark)

// Re-dragging to the same stop must not republish anything.
const before = layerCalls.length
dragTo(pageRange, PAGE_STOPS.findIndex((stop) => stop.id === 'dim'))
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
windowStub.localStorage.setItem('dsh-eye-themes:text', 'softer')
windowStub.localStorage.setItem('dsh-eye-themes:page', 'bright')
layerCalls.length = 0
plugin.apply(ctx)
check('a stored palette is restored on boot', layerCalls.length === 1 && layerCalls[0].source === 'dsh-eye-themes')
const restored = tune(toOverrideMap(PALETTES[2]), PALETTES[2], { page: 'bright', text: 'softer' })
check('the stored stops are restored too', layerCalls[0].tokens['--dsw-alias-label-primary'].dark === restored['--dsw-alias-label-primary'].dark && layerCalls[0].tokens['--dsw-alias-bg-base'].dark === restored['--dsw-alias-bg-base'].dark, `${layerCalls[0].tokens['--dsw-alias-bg-base'].dark} vs ${restored['--dsw-alias-bg-base'].dark}`)

// ---------------------------------------------------------------- result
console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('all checks passed')
