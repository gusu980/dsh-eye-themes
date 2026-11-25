// dsh-eye-themes client half — factory body. `tools/build.mjs` wraps this in the
// ModuleLoader shell and substitutes its payload and stylesheet markers.
//
// Mechanism (no CSS injected into the app): every palette is one alias-token
// override layer handed to the built-in `theme` service. ui-layout's presenter
// writes those tokens as inline custom properties on <body>, so they compose
// with the built-in light/dark switch instead of replacing it. The palette's
// day and night variants are separate values, so switching the base mode while
// a palette is active swaps to that palette's other variant.

const React = require('react')

const SOURCE = 'dsh-eye-themes'
/** Palette ids, their token maps and their per-temperature text maps, from src/palettes.mjs. */
const PAYLOAD = __PAYLOAD__
/** The three text temperatures (standard / soft / softer) offered under the swatches. */
const TEXT_PROFILES = __TEXT_PROFILES__
/** Profile used until the user picks one. */
const DEFAULT_TEXT_PROFILE = __DEFAULT_TEXT_PROFILE__
/** Owner stylesheet for the settings row (tagged so the module system reclaims it). */
const ROW_CSS = __ROW_CSS__

/** `localStorage` key holding the chosen palette id (or the off marker). */
const STORAGE_KEY = 'dsh-eye-themes:palette'
/** `localStorage` key holding the chosen text temperature. */
const TEXT_KEY = 'dsh-eye-themes:text'
/** Selection that removes the layer and hands the app back its built-in palette. */
const OFF_ID = 'default'
/** Locale namespace owning this row's copy; the slot descriptor binds it. */
const LOCALE_NS = 'settings.eye-themes'

const MESSAGES = {
  zh: {
    title: '护眼配色',
    hint: '在浅色/深色模式之上叠加，选择后立即生效',
    off: '默认',
    offHint: '使用内置配色',
    active: '使用中',
    textTitle: '文字温度',
    textHint: '越低越不刺眼，正文对比度不减到看不清',
    textHintOff: '先选一套配色，再调这里的文字温度',
  },
  en: {
    title: 'Eye-care palettes',
    hint: 'Layers over light/dark mode and applies immediately',
    off: 'Default',
    offHint: 'Use the built-in palette',
    active: 'Active',
    textTitle: 'Text warmth',
    textHint: 'Softer settings dim the copy without losing legibility',
    textHintOff: 'Pick a palette first — the choice is remembered either way',
  },
}

/** Palette lookup by id. */
const BY_ID = new Map(PAYLOAD.map((palette) => [palette.id, palette]))
/** Distinguish "user turned it off" from "nothing stored yet". */
const isOff = (id) => id === OFF_ID

const ROW_STYLE_ID = `${SOURCE}/row.css`

/** Mount the row stylesheet for exactly the owning plugin lifetime. */
function installRowCss(ctx) {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = SOURCE
    tag.dataset.pluginCss = ROW_STYLE_ID
    tag.textContent = ROW_CSS
    document.head.appendChild(tag)
    return () => tag.remove()
  }, `${SOURCE}: row stylesheet`)
}

// ---------------------------------------------------------------- state
let selection = OFF_ID
let textProfile = DEFAULT_TEXT_PROFILE
let applied = null
let appliedText = null
let disposeLayer = null
let themeService = null
let localeService = null
const listeners = new Set()
const textListeners = new Set()

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function subscribeText(listener) {
  textListeners.add(listener)
  return () => textListeners.delete(listener)
}

function announce() {
  for (const listener of listeners) listener(selection)
}

function announceText() {
  for (const listener of textListeners) listener(textProfile)
}

function readStoredText() {
  try {
    const raw = window.localStorage.getItem(TEXT_KEY)
    return TEXT_PROFILES.some((profile) => profile.id === raw) ? raw : DEFAULT_TEXT_PROFILE
  } catch {
    return DEFAULT_TEXT_PROFILE
  }
}

function writeStoredText(id) {
  try {
    window.localStorage.setItem(TEXT_KEY, id)
  } catch (error) {
    console.warn(`${SOURCE}: could not persist the text temperature`, error)
  }
}

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return OFF_ID
    return BY_ID.has(raw) || isOff(raw) ? raw : OFF_ID
  } catch {
    return OFF_ID
  }
}

function writeStored(id) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch (error) {
    console.warn(`${SOURCE}: could not persist the palette choice`, error)
  }
}

/**
 * Stack the palette's layer (or dispose it for OFF_ID).
 * Re-calling `overrideTokens` with the same source atomically replaces the
 * previous layer, so palette -> palette is a single publish.
 */
/** The palette's tokens with the selected text temperature laid over the copy tokens. */
function layerTokens(palette) {
  const text = palette.text?.[textProfile]
  return text === undefined ? palette.tokens : { ...palette.tokens, ...text }
}

function push(id) {
  const palette = BY_ID.get(id)
  if (palette === undefined) {
    if (disposeLayer !== null) {
      const dispose = disposeLayer
      disposeLayer = null
      applied = null
      dispose()
    }
    appliedText = null
    return
  }
  disposeLayer = themeService.overrideTokens(SOURCE, layerTokens(palette))
  applied = id
  appliedText = textProfile
}

function reconcile() {
  if (themeService === null) return
  if (selection !== applied || textProfile !== appliedText) push(selection)
}

function choose(id) {
  selection = id
  writeStored(id)
  reconcile()
  announce()
}

/** Switch the text temperature; a palette switch is not implied and the layer is replaced in place. */
function chooseText(id) {
  textProfile = id
  writeStoredText(id)
  reconcile()
  announceText()
}

function select(id) {
  selection = id
  reconcile()
  announce()
}

const onStorage = (event) => {
  if (event.key === null || event.key === TEXT_KEY) {
    const next = readStoredText()
    if (next !== textProfile) {
      textProfile = next
      reconcile()
      announceText()
    }
  }
  if (event.key === null || event.key === STORAGE_KEY) select(readStored())
}

/** Which variant the app is showing right now (drives the swatch preview). */
function currentMode() {
  if (typeof document === 'undefined') return 'light'
  return document.body?.hasAttribute('data-ds-dark-theme') === true ? 'dark' : 'light'
}

/** Own-property values of a package string map, in declaration order. */

/** Resolve a `{ zh, en }` package string through the active language. */
function labelOf(text) {
  if (typeof text === 'string') return text
  if (localeService !== null && typeof localeService.resolveText === 'function') {
    return localeService.resolveText(text)
  }
  return text.zh ?? text.en ?? values(text)[0]
}


// ---------------------------------------------------------------- row
const h = (type, props, ...children) => React.createElement(type, props, ...children)

/** One palette cube: three-swatch preview plus its name. */
function Cube({ id, label, hint, colors, selected, onSelect, activeLabel }) {
  return h(
    'button',
    {
      type: 'button',
      className: `dshEyeThemes_cube${selected ? ' is-selected' : ''}`,
      'aria-pressed': selected,
      title: hint,
      onClick: onSelect,
    },
    h(
      'span',
      { className: 'dshEyeThemes_swatch', 'aria-hidden': 'true' },
      colors.map((color, index) => h('i', { key: index, style: { background: color } })),
    ),
    h('span', { className: 'dshEyeThemes_label' }, label),
    selected ? h('span', { className: 'dshEyeThemes_badge' }, activeLabel) : null,
  )
}

/**
 * Settings -> General row: five palettes plus "default".
 * It owns its selection, so it needs no store seat and no injected action;
 * `t` arrives from the descriptor's `locale`, and a language switch remints it.
 */
/** One text-temperature pill. */
function Temperature({ id, label, selected, onSelect }) {
  return h(
    'button',
    {
      type: 'button',
      className: `dshEyeThemes_tier${selected ? ' is-selected' : ''}`,
      'aria-pressed': selected,
      onClick: onSelect,
    },
    label,
  )
}

function EyeThemesRow(props) {
  const t = props?.t ?? ((key) => MESSAGES.zh[key] ?? key)
  const [selected, setSelected] = React.useState(readStored)
  const [temperature, setTemperature] = React.useState(readStoredText)
  const [mode, setMode] = React.useState(currentMode)

  React.useEffect(() => subscribe((id) => setSelected(id)), [])
  React.useEffect(() => subscribeText((id) => setTemperature(id)), [])
  // Repaint the swatches when the underlying light/dark mode flips.
  React.useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return undefined
    const observer = new MutationObserver(() => setMode(currentMode()))
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [])

  const cubes = PAYLOAD.map((palette) => ({
    id: palette.id,
    label: labelOf(palette.name),
    hint: labelOf(palette.tagline),
    colors: [palette.tokens['--dsw-alias-bg-base'][mode], palette.tokens['--dsw-alias-bg-layer-2'][mode], palette.tokens['--dsw-alias-brand-primary'][mode]],
  }))

  const offColors = [
    'var(--dsw-static-neutral-100)',
    'var(--dsw-static-neutral-200)',
    'var(--dsw-static-neutral-700)',
  ]

  return h(
    'div',
    { className: 'dshEyeThemes_group' },
    h(
      'div',
      { className: 'dshEyeThemes_header' },
      h('span', { className: 'dshEyeThemes_title' }, t('title')),
      h('span', { className: 'dshEyeThemes_hint' }, t('hint')),
    ),
    h(
      'div',
      { className: 'dshEyeThemes_row' },
      ...cubes.map((cube) =>
        h(Cube, {
          key: cube.id,
          id: cube.id,
          label: cube.label,
          hint: cube.hint,
          colors: cube.colors,
          selected: selected === cube.id,
          activeLabel: t('active'),
          onSelect: () => choose(cube.id),
        }),
      ),
      h(Cube, {
        key: OFF_ID,
        id: OFF_ID,
        label: t('off'),
        hint: t('offHint'),
        colors: offColors,
        selected: selected === OFF_ID,
        activeLabel: t('active'),
        onSelect: () => choose(OFF_ID),
      }),
    ),
    h(
      'div',
      { className: 'dshEyeThemes_temperature' },
      h(
        'div',
        { className: 'dshEyeThemes_tempLabel' },
        h('span', { className: 'dshEyeThemes_titleMuted' }, t('textTitle')),
        h('span', { className: 'dshEyeThemes_hint' }, selected === OFF_ID ? t('textHintOff') : t('textHint')),
      ),
      h(
        'div',
        { className: 'dshEyeThemes_tiers', role: 'group', 'aria-label': t('textTitle') },
        ...TEXT_PROFILES.map((profile) =>
          h(Temperature, {
            key: profile.id,
            id: profile.id,
            label: labelOf(profile.label),
            selected: temperature === profile.id,
            onSelect: () => chooseText(profile.id),
          }),
        ),
      ),
    ),
  )
}

// ---------------------------------------------------------------- plugin
/** Required services: row copy, the theme registry to stack layers on, and the settings row slot. */
const inject = ['locale', 'theme', 'slots']

/**
 * Install the row stylesheet, restore the remembered palette, and contribute the
 * switcher row to Settings -> General.
 * @param ctx - client root context.
 */
function apply(ctx) {
  themeService = ctx.get('theme') ?? null
  localeService = ctx.get('locale') ?? null
  installRowCss(ctx)

  ctx.effect(() => {
    const disposers = []
    if (localeService !== null) disposers.push(localeService.register(LOCALE_NS, MESSAGES))
    textProfile = readStoredText()
    select(readStored())
    // Another window may switch the palette or the temperature; localStorage is per origin.
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      if (disposeLayer !== null) {
        disposeLayer()
        disposeLayer = null
      }
      for (const dispose of disposers) dispose()
      applied = null
      themeService = null
      localeService = null
    }
  }, `${SOURCE}: palette layer and row copy`)

  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register(
      { name: 'settings.general.item', id: 'eye-themes', order: 11.5, locale: LOCALE_NS },
      EyeThemesRow,
    ),
  )
}

exports.apply = apply
exports.inject = inject
exports.PALETTES = PAYLOAD.map((palette) => ({ id: palette.id, name: palette.name, tagline: palette.tagline }))
exports.STORAGE_KEY = STORAGE_KEY
exports.OFF_ID = OFF_ID
exports.EyeThemesRow = EyeThemesRow
