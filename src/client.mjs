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
    textHint: '越高越清晰，越低越柔和，最低 8:1',
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
    textHint: 'Higher is sharper, lower is softer, never below 8:1',
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
let pageStop = DEFAULT_PAGE_STOP
let textStop = DEFAULT_TEXT_STOP
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

function readStopId(key, stops, fallback) {
  const raw = readStorage(key)
  return stops.some((stop) => stop.id === raw) ? raw : fallback
}

function readStored() {
  const raw = readStorage(STORAGE_KEY)
  if (raw === null) return OFF_ID
  return BY_ID.has(raw) || isOff(raw) ? raw : OFF_ID
}

/** Identity of what the current layer represents, so a repeated event does not republish. */
const signature = () => `${selection}|${pageStop}|${textStop}`

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
  const tokens = tune(palette.tokens, palette, { page: pageStop, text: textStop })
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

function choosePage(id) {
  pageStop = id
  writeStorage(PAGE_KEY, id)
  reconcile()
  announce()
}

function chooseText(id) {
  textStop = id
  writeStorage(TEXT_KEY, id)
  reconcile()
  announce()
}

const onStorage = (event) => {
  const key = event.key
  if (key === null || key === STORAGE_KEY) selection = readStored()
  if (key === null || key === PAGE_KEY) pageStop = readStopId(PAGE_KEY, PAGE_STOPS, DEFAULT_PAGE_STOP)
  if (key === null || key === TEXT_KEY) textStop = readStopId(TEXT_KEY, TEXT_STOPS, DEFAULT_TEXT_STOP)
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
 * One labelled slider: a native range input stepped over the stop list, so it is
 * draggable, keyboard-operable (arrows / Home / End) and screen-reader friendly
 * without any custom drag code.
 */
function Slider({ label, hint, stops, index, valueText, disabled, onChange }) {
  const last = Math.max(0, stops.length - 1)
  const position = Math.max(0, Math.min(last, index))
  const stop = stops[position]
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
        labelOf(stop.label),
        valueText === undefined ? null : h('span', { className: 'dshEyeThemes_sliderUnit' }, ` · ${valueText}`),
      ),
    ),
    h('input', {
      type: 'range',
      className: 'dshEyeThemes_range',
      min: 0,
      max: last,
      step: 1,
      value: position,
      disabled: disabled === true,
      'aria-label': label,
      'aria-valuetext': labelOf(stop.label),
      title: hint,
      onChange: (event) => onChange(stops[Number(event.target.value)]?.id),
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
  const [page, setPage] = React.useState(() => readStopId(PAGE_KEY, PAGE_STOPS, DEFAULT_PAGE_STOP))
  const [text, setText] = React.useState(() => readStopId(TEXT_KEY, TEXT_STOPS, DEFAULT_TEXT_STOP))
  const [mode, setMode] = React.useState(currentMode)

  React.useEffect(
    () =>
      subscribe(() => {
        setSelected(selection)
        setPage(pageStop)
        setText(textStop)
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

  const pageIndex = PAGE_STOPS.findIndex((stop) => stop.id === page)
  const textIndex = TEXT_STOPS.findIndex((stop) => stop.id === text)
  const active = selected !== OFF_ID

  // Show the contrast the text slider actually lands on, so the stop names stay honest.
  const palette = BY_ID.get(selected)
  const textValue = palette === undefined
    ? undefined
    : `${measure(palette.tokens, palette, { page, text })[mode].primary.toFixed(1)}:1`

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
        stops: PAGE_STOPS,
        index: pageIndex,
        disabled: !active,
        onChange: choosePage,
      }),
      h(Slider, {
        label: t('textTitle'),
        hint: t('textHint'),
        stops: TEXT_STOPS,
        index: textIndex,
        valueText: textValue,
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
    pageStop = readStopId(PAGE_KEY, PAGE_STOPS, DEFAULT_PAGE_STOP)
    textStop = readStopId(TEXT_KEY, TEXT_STOPS, DEFAULT_TEXT_STOP)
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
exports.PAGE_STOPS = PAGE_STOPS
exports.TEXT_STOPS = TEXT_STOPS
exports.OFF_ID = OFF_ID
exports.EyeThemesRow = EyeThemesRow
exports.Slider = Slider
