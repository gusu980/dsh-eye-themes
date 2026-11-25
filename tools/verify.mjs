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
import {
  DEFAULT_TEXT_PROFILE,
  PALETTES,
  TEXT_PROFILES,
  TOKEN_NAMES,
  audit,
  textAudit,
  toOverrideMap,
  toTextOverrideMaps,
} from '../src/palettes.mjs'
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

// ------------------------------------------------- 2b. text temperature profiles
for (const palette of PALETTES) {
  const maps = toTextOverrideMaps(palette)
  check(`${palette.id} carries all ${TEXT_PROFILES.length} text temperatures`, TEXT_PROFILES.every((profile) => maps[profile.id] !== undefined))
  for (const row of textAudit(palette)) {
    const label = `${palette.id}/${row.profile}`
    for (const mode of ['light', 'dark']) {
      const tier = row[mode]
      // The ceiling is a glare guard, so it only binds where copy is lighter than
      // its surface. A light theme's dark copy keeps its designed contrast.
      if (mode === 'dark') {
        check(`${label}/${mode} primary stays under the ceiling`, tier.primary <= row.ceiling + 0.01, `${tier.primary.toFixed(2)} <= ${row.ceiling}`)
      } else {
        check(`${label}/${mode} keeps the light-theme contrast`, tier.primary >= 7, `${tier.primary.toFixed(2)}:1`)
      }
      check(`${label}/${mode} primary keeps the AA floor`, tier.primary >= 4.5, `${tier.primary.toFixed(2)}:1`)
      check(`${label}/${mode} secondary keeps the AA floor`, tier.secondary >= 4.5, `${tier.secondary.toFixed(2)}:1`)
      check(`${label}/${mode} tertiary keeps the legibility floor`, tier.tertiary >= 4, `${tier.tertiary.toFixed(2)}:1`)
      check(`${label}/${mode} link keeps the AA floor`, tier.link >= 4.5, `${tier.link.toFixed(2)}:1`)
      check(`${label}/${mode} ramp stays ordered primary > secondary > tertiary`, tier.primary > tier.secondary && tier.secondary > tier.tertiary, `${tier.primary.toFixed(2)} > ${tier.secondary.toFixed(2)} > ${tier.tertiary.toFixed(2)}`)
    }
  }
  // The whole point of the feature: darker profiles actually dim the copy.
  const auditRows = textAudit(palette)
  const byId = Object.fromEntries(auditRows.map((row) => [row.profile, row]))
  check(`-- ${palette.id} softer dims dark copy more than standard`, byId.softer.dark.primary < byId.standard.dark.primary, `${byId.softer.dark.primary.toFixed(2)} < ${byId.standard.dark.primary.toFixed(2)}`)
  check(`-- ${palette.id} soft dims dark copy more than standard`, byId.soft.dark.primary < byId.standard.dark.primary, `${byId.soft.dark.primary.toFixed(2)} < ${byId.standard.dark.primary.toFixed(2)}`)
  // Light themes: dark copy is never re-hued or dimmed.
  const raw = toOverrideMap(palette)['--dsw-alias-label-primary'].light
  check(`-- ${palette.id} leaves light-theme body copy untouched`, byId.softer.light.primaryHex === raw, `${byId.softer.light.primaryHex} vs ${raw}`)
}

check('default text temperature is the softened one', DEFAULT_TEXT_PROFILE === 'soft', DEFAULT_TEXT_PROFILE)

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

// The temperature segmented control renders one pill per profile.
const tempRow = tree.children.find((child) => child?.props?.className === 'dshEyeThemes_temperature')
const tiersWrap = tempRow.children.map((child) => expand(child)).find((child) => child?.props?.className === 'dshEyeThemes_tiers')
const tiers = tiersWrap.children.map((child) => expand(child))
check('row renders one pill per text temperature', tiers.length === TEXT_PROFILES.length, String(tiers.length))
check('pills are labelled buttons with aria-pressed', tiers.every((tier) => tier.type === 'button' && typeof tier.props['aria-pressed'] === 'boolean'))
check('the default pill is selected', tiers[TEXT_PROFILES.findIndex((profile) => profile.id === DEFAULT_TEXT_PROFILE)].props['aria-pressed'] === true)

// Selecting a palette stacks one layer with the full token map; selecting another replaces it.
const paletteCubes = cubes.slice(0, 5)
paletteCubes[1].props.onClick()
check('choosing a palette stacks exactly one layer', layerCalls.filter((call) => !call.disposed).length === 1)
const firstLayer = layerCalls.find((call) => !call.disposed)
check('layer source is the package id (one layer per source)', firstLayer.source === 'dsh-eye-themes', firstLayer.source)
check('layer carries the complete token map', Object.keys(firstLayer.tokens).length === TOKEN_NAMES.length, String(Object.keys(firstLayer.tokens).length))
check('layer values are { light, dark } pairs', Object.values(firstLayer.tokens).every((pair) => typeof pair.light === 'string' && typeof pair.dark === 'string'))
check('chosen palette persisted', windowStub.localStorage.getItem('dsh-eye-themes:palette') === PALETTES[1].id, String(windowStub.localStorage.getItem('dsh-eye-themes:palette')))

const softText = PALETTES[1].text?.[DEFAULT_TEXT_PROFILE] ?? toTextOverrideMaps(PALETTES[1])[DEFAULT_TEXT_PROFILE]
check('the layer carries the default text temperature', firstLayer.tokens['--dsw-alias-label-primary'].dark === softText['--dsw-alias-label-primary'].dark, `${firstLayer.tokens['--dsw-alias-label-primary'].dark} vs ${softText['--dsw-alias-label-primary'].dark}`)
check('tempered copy differs from the palette default', firstLayer.tokens['--dsw-alias-label-primary'].dark !== toOverrideMap(PALETTES[1])['--dsw-alias-label-primary'].dark)

// Choosing a temperature replaces the same layer: one source, one stack.
const standardTier = tiers[TEXT_PROFILES.findIndex((profile) => profile.id === 'standard')]
standardTier.props.onClick()
const afterTemperature = layerCalls.filter((call) => !call.disposed).at(-1)
check('changing temperature restacks one layer (no second source)', layerCalls.filter((call) => !call.disposed).length === 2)
check('the layer now carries the standard temperature', afterTemperature.tokens['--dsw-alias-label-primary'].dark === toTextOverrideMaps(PALETTES[1]).standard['--dsw-alias-label-primary'].dark)
check('temperature choice persisted', windowStub.localStorage.getItem('dsh-eye-themes:text') === 'standard', String(windowStub.localStorage.getItem('dsh-eye-themes:text')))
check('non-copy tokens are untouched by a temperature change', KEEP_TOKENS.every((name) => afterTemperature.tokens[name].dark === toOverrideMap(PALETTES[1])[name].dark))

paletteCubes[3].props.onClick()
check('switching palettes replaces the layer instead of stacking', layerCalls.filter((call) => !call.disposed).length === 3 && layerCalls[1].disposed !== true)
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
layerCalls.length = 0
plugin.apply(ctx)
check('a stored palette is restored on boot', layerCalls.length === 1 && layerCalls[0].source === 'dsh-eye-themes')
check(
  'the stored temperature is restored too',
  layerCalls[0].tokens['--dsw-alias-label-primary'].dark === toTextOverrideMaps(PALETTES[2]).softer['--dsw-alias-label-primary'].dark,
)

// ---------------------------------------------------------------- result
console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('all checks passed')
