// dsh-eye-themes client half — factory body. `tools/build.mjs` wraps this in the
// ModuleLoader shell, inlines src/color.mjs + src/tune.mjs above it, and
// substitutes the payload / stops / stylesheet markers.
//
// Mechanism (no CSS injected into the app): a palette is one alias-token
// override layer handed to the built-in `theme` service, and the two sliders are
// applied to it at runtime by `tune()` — page brightness scales the surface
// tokens, text brightness re-lands every label tier on its contrast target
// against the brightened surface. ui-layout's presenter then writes the result
// as inline custom properties on <body>, so it composes with the built-in
// light/dark switch instead of replacing it.

const React = require('react')

const SOURCE = 'dsh-eye-themes'
/** Palette ids and their full token maps, generated from src/palettes.mjs. */
const PAYLOAD = __PAYLOAD__
/** Page-brightness stops, text stops and their defaults come from the inlined tuner. */
/** Owner stylesheet for the settings row (tagged so the module system reclaims it). */
const ROW_CSS = __ROW_CSS__

/** `localStorage` keys: chosen palette (or the off marker), page stop, text stop. */
const STORAGE_KEY = 'dsh-eye-themes:palette'
const PAGE_KEY = 'dsh-eye-themes:page'
const TEXT_KEY = 'dsh-eye-themes:text'
/** Selection that removes the layer and hands the app back its built-in palette. */
const OFF_ID = 'default'
/** Locale namespace owning this row's copy; the slot descriptor binds it. */
const LOCALE_NS = 'settings.eye-themes'

const MESSAGES = {
  zh: {
    title: '护眼配色',
    hint: '在浅色/深色模式之上叠加，拖动立即生效',
    off: '默认',
    offHint: '使用内置配色',
    active: '使用中',
    pageTitle: '页面亮度',
    pageHint: '只影响背景与卡片，不动文字',
    textTitle: '文字亮度',
    textHint: '无级可调，越低越柔和；最低 8:1',
    textHintOff: '先选一套配色，两档滑条才会生效',
  },
  en: {
    title: 'Eye-care palettes',
    hint: 'Layers over light/dark mode and applies as you drag',
    off: 'Default',
    offHint: 'Use the built-in palette',
    active: 'Active',
    pageTitle: 'Page brightness',
    pageHint: 'Surfaces only — text is untouched',
    textTitle: 'Text brightness',
    textHint: 'Continuously adjustable, never below 8:1',
    textHintOff: 'Pick a palette first — both sliders apply to it',
  },
}

/** Palette lookup by id. */
const BY_ID = new Map(PAYLOAD.map((palette) => [palette.id, palette]))
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
let pageValue = DEFAULT_PAGE_VALUE
let textValue = DEFAULT_TEXT_VALUE
let applied = null
let appliedSignature = null
let disposeLayer = null
let themeService = null
let localeService = null
const listeners = new Set()

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function announce() {
  for (const listener of listeners) listener()
}

function readStorage(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch (error) {
    console.warn(`${SOURCE}: could not persist ${key}`, error)
  }
}

/**
 * Read a knob from storage. Accepts the numeric values this release writes and
 * the named stop ids the fixed-stop release wrote, so upgrading keeps the user's
 * choice instead of resetting it.
 */
function readValue(key, range, presets, fallback) {
  return resolveValue(readStorage(key), range, presets, fallback)
}

function readStored() {
  const raw = readStorage(STORAGE_KEY)
  if (raw === null) return OFF_ID
  return BY_ID.has(raw) || isOff(raw) ? raw : OFF_ID
}

/** Identity of what the current layer represents, so a repeated event does not republish. */
const signature = () => `${selection}|${pageValue}|${textValue}`

/**
 * Stack the palette's layer with both sliders applied (or dispose it for OFF_ID).
 * Re-calling `overrideTokens` with the same source atomically replaces the
 * previous layer, so dragging is one publish per stop — never a stack of layers.
 */
function push(id) {
  const palette = BY_ID.get(id)
  if (palette === undefined) {
    if (disposeLayer !== null) {
      const dispose = disposeLayer
      disposeLayer = null
      applied = null
      appliedSignature = null
      dispose()
    }
    return
  }
  const signatureNow = signature()
  if (applied === id && appliedSignature === signatureNow) return
  const tokens = tune(palette.tokens, palette, { page: pageValue, text: textValue })
  disposeLayer = themeService.overrideTokens(SOURCE, tokens)
  applied = id
  appliedSignature = signatureNow
}

function reconcile() {
  if (themeService === null) return
  push(selection)
}

function choose(id) {
  selection = id
  writeStorage(STORAGE_KEY, id)
  reconcile()
  announce()
}

/**
 * Repainting means rewriting 146 inline custom properties and re-publishing the
 * theme, so a continuous drag is coalesced into one repaint per animation frame.
 * The readout still updates immediately — only the theme publish is deferred.
 */
let frame = 0
function reconcileSoon() {
  if (typeof requestAnimationFrame !== 'function') {
    reconcile()
    return
  }
  if (frame !== 0) return
  frame = requestAnimationFrame(() => {
    frame = 0
    reconcile()
  })
}

function choosePage(value) {
  pageValue = quantizeValue(value, PAGE_RANGE, DEFAULT_PAGE_VALUE)
  writeStorage(PAGE_KEY, pageValue)
  reconcileSoon()
  announce()
}

function chooseText(value) {
  textValue = quantizeValue(value, TEXT_RANGE, DEFAULT_TEXT_VALUE)
  writeStorage(TEXT_KEY, textValue)
  reconcileSoon()
  announce()
}

const onStorage = (event) => {
  const key = event.key
  if (key === null || key === STORAGE_KEY) selection = readStored()
  if (key === null || key === PAGE_KEY) pageValue = readValue(PAGE_KEY, PAGE_RANGE, PAGE_PRESETS, DEFAULT_PAGE_VALUE)
  if (key === null || key === TEXT_KEY) textValue = readValue(TEXT_KEY, TEXT_RANGE, TEXT_PRESETS, DEFAULT_TEXT_VALUE)
  reconcile()
  announce()
}

/** Which variant the app is showing right now (drives the swatch preview). */
function currentMode() {
  if (typeof document === 'undefined') return 'light'
  return document.body?.hasAttribute('data-ds-dark-theme') === true ? 'dark' : 'light'
}

/** Own-property values of a package string map, in declaration order. */
const values = (object) => Object.keys(object).map((key) => object[key])

/** Resolve a `{ zh, en }` package string through the active language. */
function labelOf(text) {
  if (typeof text === 'string') return text
  if (localeService !== null && typeof localeService.resolveText === 'function') {
    return localeService.resolveText(text)
  }
  return text.zh ?? text.en ?? values(text)[0]
}

const h = (type, props, ...children) => React.createElement(type, props, ...children)

// ---------------------------------------------------------------- row

/** One palette cube: three-swatch preview plus its name. */
function Cube({ label, hint, colors, selected, onSelect, activeLabel }) {
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
 * One labelled slider over a continuous range.
 *
 * Native `input[type=range]`, so dragging, arrow keys (one `step` each),
 * PageUp/PageDown and Home/End all work without custom drag code. The readout
 * shows the nearest named landmark plus the real number, so a value between
 * landmarks still reads as a sentence ("柔和 · 9.6:1").
 */
function Slider({ label, hint, range, value, name, readout, disabled, onChange }) {
  return h(
    'div',
    { className: `dshEyeThemes_slider${disabled ? ' is-disabled' : ''}` },
    h(
      'div',
      { className: 'dshEyeThemes_sliderHead' },
      h('span', { className: 'dshEyeThemes_sliderLabel' }, label),
      h(
        'span',
        { className: 'dshEyeThemes_sliderValue' },
        name,
        readout === undefined ? null : h('span', { className: 'dshEyeThemes_sliderUnit' }, ` · ${readout}`),
      ),
    ),
    h('input', {
      type: 'range',
      className: 'dshEyeThemes_range',
      min: range.min,
      max: range.max,
      step: range.step,
      value,
      disabled: disabled === true,
      'aria-label': label,
      'aria-valuetext': readout === undefined ? name : `${name} ${readout}`,
      title: hint,
      onChange: (event) => onChange(Number(event.target.value)),
    }),
    h('span', { className: 'dshEyeThemes_sliderHint' }, hint),
  )
}

/**
 * Settings -> General row: five palette cubes, then two draggable sliders.
 * It owns its state, so it needs no store seat and no injected action; `t`
 * arrives from the descriptor's `locale`, and a language switch remints it.
 */
function EyeThemesRow(props) {
  const t = props?.t ?? ((key) => MESSAGES.zh[key] ?? key)
  const [selected, setSelected] = React.useState(readStored)
  const [page, setPage] = React.useState(() => readValue(PAGE_KEY, PAGE_RANGE, PAGE_PRESETS, DEFAULT_PAGE_VALUE))
  const [text, setText] = React.useState(() => readValue(TEXT_KEY, TEXT_RANGE, TEXT_PRESETS, DEFAULT_TEXT_VALUE))
  const [mode, setMode] = React.useState(currentMode)

  React.useEffect(
    () =>
      subscribe(() => {
        setSelected(selection)
        setPage(pageValue)
        setText(textValue)
      }),
    [],
  )

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
    colors: [
      palette.tokens['--dsw-alias-bg-base'][mode],
      palette.tokens['--dsw-alias-bg-layer-2'][mode],
      palette.tokens['--dsw-alias-brand-primary'][mode],
    ],
  }))

  const offColors = [
    'var(--dsw-static-neutral-100)',
    'var(--dsw-static-neutral-200)',
    'var(--dsw-static-neutral-700)',
  ]

  const active = selected !== OFF_ID

  // Show what each slider actually lands on, so the readout stays honest between landmarks.
  const palette = BY_ID.get(selected)
  const measured = palette === undefined ? undefined : measure(palette.tokens, palette, { page, text })[mode]
  const textReadout = measured === undefined ? undefined : `${measured.primary.toFixed(2)}:1`
  const pageReadout = `${Math.round(page * 100)}%`

  return h(
    'div',
    { className: 'dshEyeThemes_group' },
    h(
      'div',
      { className: 'dshEyeThemes_header' },
      h('span', { className: 'dshEyeThemes_title' }, t('title')),
      h('span', { className: 'dshEyeThemes_hint' }, active ? t('hint') : t('textHintOff')),
    ),
    h(
      'div',
      { className: 'dshEyeThemes_row' },
      ...cubes.map((cube) =>
        h(Cube, {
          key: cube.id,
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
      { className: 'dshEyeThemes_sliders' },
      h(Slider, {
        label: t('pageTitle'),
        hint: t('pageHint'),
        range: PAGE_RANGE,
        value: page,
        name: labelOf(nearestPreset(page, PAGE_PRESETS).label),
        readout: pageReadout,
        disabled: !active,
        onChange: choosePage,
      }),
      h(Slider, {
        label: t('textTitle'),
        hint: t('textHint'),
        range: TEXT_RANGE,
        value: text,
        name: labelOf(nearestPreset(text, TEXT_PRESETS).label),
        readout: textReadout,
        disabled: !active,
        onChange: chooseText,
      }),
    ),
  )
}

// ---------------------------------------------------------------- plugin
/** Required services: row copy, the theme registry to stack layers on, and the settings row slot. */
const inject = ['locale', 'theme', 'slots']

/**
 * Install the row stylesheet, restore the remembered palette and both stops, and
 * contribute the switcher row to Settings -> General.
 * @param ctx - client root context.
 */
function apply(ctx) {
  themeService = ctx.get('theme') ?? null
  localeService = ctx.get('locale') ?? null
  installRowCss(ctx)

  ctx.effect(() => {
    const disposers = []
    if (localeService !== null) disposers.push(localeService.register(LOCALE_NS, MESSAGES))
    pageValue = readValue(PAGE_KEY, PAGE_RANGE, PAGE_PRESETS, DEFAULT_PAGE_VALUE)
    textValue = readValue(TEXT_KEY, TEXT_RANGE, TEXT_PRESETS, DEFAULT_TEXT_VALUE)
    selection = readStored()
    reconcile()
    // Another window may switch the palette or move a slider; localStorage is per origin.
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      if (disposeLayer !== null) {
        disposeLayer()
        disposeLayer = null
      }
      for (const dispose of disposers) dispose()
      applied = null
      appliedSignature = null
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
exports.STORAGE_KEYS = { palette: STORAGE_KEY, page: PAGE_KEY, text: TEXT_KEY }
exports.PAGE_RANGE = PAGE_RANGE
exports.TEXT_RANGE = TEXT_RANGE
exports.PAGE_PRESETS = PAGE_PRESETS
exports.TEXT_PRESETS = TEXT_PRESETS
exports.OFF_ID = OFF_ID
exports.EyeThemesRow = EyeThemesRow
exports.Slider = Slider
