/**
 * The five eye-care palettes: two seed sets per palette (day + night) expanded
 * into the full `--dsw-*` alias surface the app reads.
 *
 * Design rules, applied to every palette:
 *  - never pure white on pure black: base surfaces stay between #ECEDE7..#F7F2E7
 *    (day) and #14171A..#242620 (night), so the eye never faces a 21:1 glare wall;
 *  - body text stays >= 7:1 (AAA) and secondary text >= 4.5:1 on the base surface;
 *  - accents are muted (chroma capped), because saturated accents fatigue over
 *    long sessions and pull attention away from the conversation;
 *  - each palette ships a day AND a night variant of the same hue family, so the
 *    built-in light/dark switch keeps working underneath it.
 */
import { alpha, contrast, ensureContrast, format, luminance, mix, parse, readableOn } from './color.mjs'

/** Ordered token names — the exact alias surface every palette provides. */
export const TOKEN_NAMES = [
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-module-platform', '--dsw-alias-bg-multi-select', '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-document-preview', '--dsw-alias-bg-skeleton', '--dsw-alias-bg-mask-1',
  '--dsw-alias-bg-mask-2', '--dsw-alias-bg-mask-3', '--dsw-alias-bg-mask-photo',
  '--dsw-alias-bg-mask-drop', '--dsw-alias-bg-document-selection', '--dsw-alias-border-l1',
  '--dsw-alias-border-l2', '--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-border-l3',
  '--dsw-alias-border-l4', '--dsw-alias-border-inverted', '--dsw-alias-border-inverted2',
  '--dsw-alias-label-primary', '--dsw-alias-label-primary-dimmed', '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-primary-inverted', '--dsw-alias-label-primary-bluish', '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary', '--dsw-alias-label-caption', '--dsw-alias-label-dimmed',
  '--dsw-alias-label-document-preview', '--dsw-alias-label-shimmer', '--dsw-alias-label-deep-diving',
  '--dsw-alias-label-deep-diving-shimmer', '--dsw-alias-link', '--dsw-alias-settings-card-fill',
  '--dsw-alias-settings-card-stroke', '--dsw-alias-brand-primary', '--dsw-alias-brand-primary-invert',
  '--dsw-alias-brand-primary-new-colorprimary-new-color', '--dsw-alias-brand-text',
  '--dsw-alias-button-contrast-fill', '--dsw-alias-button-elevated-fill', '--dsw-alias-button-floating-fill',
  '--dsw-alias-button-floating-hover', '--dsw-alias-button-ghost-active-border',
  '--dsw-alias-button-ghost-active-fill', '--dsw-alias-button-ghost-active-hover',
  '--dsw-alias-button-info-fill', '--dsw-alias-button-info-hover', '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover', '--dsw-alias-button-tool-bar-fill',
  '--dsw-alias-button-tool-bar-fill-invisible', '--dsw-alias-button-tool-bar-hover',
  '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover-accent', '--dsw-alias-interactive-bg-hover-danger',
  '--dsw-alias-interactive-bg-hover-solid', '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-block-banner', '--dsw-alias-markdown-code-segment-selected',
  '--dsw-alias-markdown-code-segment-unselected', '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-citation', '--dsw-alias-markdown-placeholder', '--dsw-alias-markdown-tag',
  '--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2', '--dsw-alias-scrollbar-hover-l1',
  '--dsw-alias-scrollbar-hover-l2', '--dsw-alias-state-business-primary', '--dsw-alias-state-business-tertiary',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-error-secondary', '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary', '--dsw-alias-state-success-secondary',
  '--dsw-alias-state-success-tertiary', '--dsw-alias-state-warn-primary', '--dsw-alias-state-warn-secondary',
  '--dsw-alias-state-warn-tertiary', '--dsw-alias-state-warn-label', '--dsw-alias-code-diff-added',
  '--dsw-alias-code-diff-deleted', '--dsw-alias-file-diff-added-bg', '--dsw-alias-file-diff-added-gutter',
  '--dsw-alias-file-diff-added-marker', '--dsw-alias-file-diff-deleted-bg',
  '--dsw-alias-file-diff-deleted-gutter', '--dsw-alias-file-diff-deleted-marker',
  '--dsw-alias-menu-group-header-fill', '--dsw-alias-menu-icon', '--dsw-alias-toast-bg',
  '--dsw-alias-toast-label', '--dsw-alias-tooltip-bg', '--dsw-alias-tooltip-key-bg',
  '--dsw-alias-turn-trigger-bg', '--dsw-alias-turn-trigger-bg-hover', '--dsw-alias-onboarding-accent',
  '--dsw-alias-onboarding-card-fill', '--dsw-alias-onboarding-secondary-fill',
  '--dsw-alias-onboarding-checkbox-border', '--dsw-alias-switch-thumb', '--dsw-specific-sidebar-fill',
  '--dsw-specific-sidebar-nav-item-hover', '--dsw-specific-sidebar-nav-item-active',
  '--dsw-specific-sidebar-nav-item-active-accent', '--dsw-specific-menu', '--dsw-menu-surface-fill',
  '--dsw-specific-bubble', '--dsw-specific-bubble-highlight', '--dsw-specific-input-major',
  '--dsw-specific-login-input', '--dsw-specific-selector', '--dsw-specific-tip',
  '--dsw-linear-gradient-think', '--dsw-linear-think-select', '--dsw-static-neutral-00',
  '--dsw-static-neutral-50', '--dsw-static-neutral-100', '--dsw-static-neutral-200',
  '--dsw-static-neutral-400', '--dsw-static-neutral-700', '--dsw-static-neutral-800',
  '--dsw-static-neutral-850', '--dsw-static-neutral-1000', '--dsw-static-neutral-bluish-00',
  '--dsw-static-neutral-bluish-400', '--dsw-static-neutral-bluish-1000', '--dsw-static-blue-400',
  '--dsw-static-blue-450', '--dsw-static-blue-500', '--dsw-static-blue-600',
  '--shiki-token-constant', '--shiki-token-string', '--shiki-token-comment', '--shiki-token-keyword',
  '--shiki-token-parameter', '--shiki-token-function', '--shiki-token-string-expression',
  '--shiki-token-punctuation', '--shiki-token-link',
]

/**
 * Palette seeds. Everything else is derived.
 * `base`   page background        `raised` cards/popovers      `panel` nested surfaces
 * `ink`    primary text           `ink2` secondary             `ink3` tertiary
 * `accent` brand/CTA              `link` links                 `border` hairline
 * `code`   code-block background  `syntax` optional per-palette syntax hue skew
 */
export const PALETTES = [
  {
    id: 'paper',
    name: { zh: '宣纸', en: 'Paper' },
    tagline: { zh: '暖米黄 · 久读不涩', en: 'Warm cream — easy on long reads' },
    light: {
      base: '#F5F0E1', raised: '#FAF6EA', panel: '#EFE9D6',
      ink: '#2E2A22', ink2: '#4A4535', ink3: '#6E6857',
      accent: '#8A5A2B', link: '#7A4F1F', border: '#D8D0B4', code: '#EDE6D0',
    },
    dark: {
      base: '#211F19', raised: '#2B281F', panel: '#322E26',
      ink: '#EAE3D0', ink2: '#C2BBA5', ink3: '#98917A',
      accent: '#D2A257', link: '#E3BE79', border: '#443D2E', code: '#292620',
    },
  },
  {
    id: 'sage',
    name: { zh: '豆沙绿', en: 'Sage' },
    tagline: { zh: '经典护眼绿 · 缓解屏幕刺目', en: 'The classic eye-care green' },
    light: {
      base: '#CCE8CF', raised: '#D7EDDA', panel: '#C1E0C6',
      ink: '#1F2E20', ink2: '#3A4A3C', ink3: '#54665A',
      accent: '#2B6440', link: '#20553A', border: '#AFD1B6', code: '#C4E1C9',
    },
    dark: {
      base: '#16231A', raised: '#1D2C21', panel: '#233528',
      ink: '#D9E7D8', ink2: '#AEC4AE', ink3: '#84987F',
      accent: '#6FB88C', link: '#95CFAB', border: '#334C3A', code: '#1C2C21',
    },
  },
  {
    id: 'mist',
    name: { zh: '月白', en: 'Mist' },
    tagline: { zh: '冷灰白 · 明亮环境首选', en: 'Cool neutral — for bright rooms' },
    light: {
      base: '#ECEDE7', raised: '#F3F4EF', panel: '#E2E4DD',
      ink: '#2A2E2A', ink2: '#4C524C', ink3: '#666D67',
      accent: '#33667A', link: '#2A5A6D', border: '#CDD2CB', code: '#E3E5DE',
    },
    dark: {
      base: '#1A1D20', raised: '#212528', panel: '#272C30',
      ink: '#D6DCE0', ink2: '#AAB2B6', ink3: '#808A8E',
      accent: '#7FB0C4', link: '#9AC8DA', border: '#394248', code: '#202529',
    },
  },
  {
    id: 'ink',
    name: { zh: '墨夜', en: 'Ink Night' },
    tagline: { zh: '无彩中性 · 夜间不偏色', en: 'Neutral greys — no colour cast' },
    light: {
      base: '#EDEDEB', raised: '#F4F4F2', panel: '#E3E3E0',
      ink: '#26262A', ink2: '#47474C', ink3: '#6A6A70',
      accent: '#4B4E6B', link: '#3D4060', border: '#CFCFCB', code: '#E4E4E1',
    },
    dark: {
      base: '#16171A', raised: '#1D1E22', panel: '#232428',
      ink: '#D8D8DC', ink2: '#AEAEB4', ink3: '#828288',
      accent: '#9AA0C8', link: '#AFB4D8', border: '#34353B', code: '#1C1D21',
    },
  },
  {
    id: 'amber',
    name: { zh: '霞光', en: 'Amber' },
    tagline: { zh: '暖杏暮色 · 蓝光最少', en: 'Warm dusk — least blue light' },
    light: {
      base: '#F6EDE0', raised: '#FBF4EA', panel: '#F0E4D2',
      ink: '#33281F', ink2: '#4F4235', ink3: '#736356',
      accent: '#9A5230', link: '#8A4526', border: '#DFCFB8', code: '#F0E4D2',
    },
    dark: {
      base: '#1D1512', raised: '#261C17', panel: '#2D221B',
      ink: '#E2D2C1', ink2: '#C2AF9B', ink3: '#998674',
      accent: '#D08E5F', link: '#E4A97D', border: '#3F3126', code: '#241B16',
    },
  },
]

/** Syntax hue roles: [dayHex, nightHex] before contrast repair against the code surface. */
const SYNTAX = {
  constant: ['#1F5F8B', '#7FB8D4'],
  string: ['#2F6B3A', '#9CCB88'],
  keyword: ['#8A3A6B', '#D6A0C4'],
  parameter: ['#8A5216', '#DDB07A'],
  function: ['#4A3E8F', '#B7AEE6'],
  stringExpression: ['#24603F', '#8FCBA4'],
  link: ['#1F5F8B', '#8FC4E0'],
}

/**
 * Expand one palette seed set into the full alias token map for one mode.
 * @param seed - the palette's `light` or `dark` seed record.
 * @param mode - `light` or `dark`, which selects the literal and alpha recipes.
 * @returns every `--dsw-*`/`--shiki-*` name mapped to one CSS value.
 */
export function derive(seed, mode) {
  const { base, raised, panel, ink, ink2, ink3, accent, link, border, code } = seed
  const isLight = mode === 'light'
  const onBase = readableOn(base)
  const onAccent = readableOn(accent, '#171717', '#fbfbfa')

  // Semantic hues per mode: darker/deeper in daylight, lighter/pastel at night.
  const success = isLight ? '#3D6B2E' : '#93C68C'
  const error = isLight ? '#A33B33' : '#E29086'
  const warn = isLight ? '#8F640F' : '#E2B96B'
  const business = isLight ? '#2E5C88' : '#93BBD8'
  const danger = error

  // Neutral ramp, lightest -> darkest, used by the static scale.
  const rampStart = isLight ? mix(base, '#ffffff', 0.6) : mix(ink, '#ffffff', 0.35)
  const rampEnd = isLight ? mix(ink, '#000000', 0.15) : mix(base, '#000000', 0.35)
  const ramp = (t) => mix(rampStart, rampEnd, t)

  const overlay = isLight ? mix(raised, '#ffffff', 0.5) : mix(panel, '#ffffff', 0.05)
  const floating = isLight ? mix(raised, '#ffffff', 0.35) : mix(panel, '#ffffff', 0.06)
  const hover = alpha(ink, isLight ? 0.06 : 0.08)
  const hoverActive = alpha(ink, isLight ? 0.1 : 0.14)
  const solid = mix(panel, ink, isLight ? 0.06 : 0.08)
  const layer3 = mix(panel, ink, isLight ? 0.05 : 0.07)
  const toastBg = isLight ? mix(ink, base, 0.12) : mix(panel, '#ffffff', 0.07)
  const tooltipBg = isLight ? mix(ink, base, 0.06) : mix(panel, '#ffffff', 0.08)
  const thinkTint = mix(base, ink, isLight ? 0.04 : 0.05)

  const tokens = {
    // ---- surfaces
    '--dsw-alias-bg-base': base,
    '--dsw-alias-bg-layer-1': raised,
    '--dsw-alias-bg-layer-2': panel,
    '--dsw-alias-bg-layer-3': layer3,
    '--dsw-alias-bg-module-platform': mix(base, ink, isLight ? 0.055 : 0.07),
    '--dsw-alias-bg-multi-select': mix(base, accent, 0.12),
    '--dsw-alias-bg-overlay': overlay,
    '--dsw-alias-bg-document-preview': panel,
    '--dsw-alias-bg-skeleton': alpha(ink, 0.08),
    '--dsw-alias-bg-mask-1': alpha(isLight ? ink : '#000000', isLight ? 0.26 : 0.5),
    '--dsw-alias-bg-mask-2': alpha(isLight ? ink : '#000000', isLight ? 0.13 : 0.2),
    '--dsw-alias-bg-mask-3': alpha(isLight ? ink : '#000000', isLight ? 0.46 : 0.48),
    '--dsw-alias-bg-mask-photo': alpha(isLight ? ink : '#000000', isLight ? 0.86 : 0.88),
    '--dsw-alias-bg-mask-drop': alpha(base, 0.72),
    '--dsw-alias-bg-document-selection': `color-mix(in srgb, ${accent} 38%, transparent)`,

    // ---- borders
    '--dsw-alias-border-l1': alpha(ink, 0.12),
    '--dsw-alias-border-l2': alpha(ink, 0.2),
    '--dsw-alias-border-l2-darkmode-thin': alpha(ink, isLight ? 0.2 : 0.16),
    '--dsw-alias-border-l3': alpha(ink, 0.26),
    '--dsw-alias-border-l4': alpha(ink, 0.34),
    '--dsw-alias-border-inverted': isLight ? 'rgba(0, 0, 0, 0)' : alpha('#ffffff', 0.06),
    '--dsw-alias-border-inverted2': isLight ? 'rgba(0, 0, 0, 0)' : alpha('#ffffff', 0.09),

    // ---- labels
    '--dsw-alias-label-primary': ink,
    '--dsw-alias-label-primary-dimmed': mix(ink, base, 0.24),
    '--dsw-alias-label-primary-foreground': onBase,
    '--dsw-alias-label-primary-inverted': base,
    '--dsw-alias-label-primary-bluish': mix(ink, accent, 0.22),
    '--dsw-alias-label-secondary': ink2,
    '--dsw-alias-label-tertiary': ink3,
    '--dsw-alias-label-caption': mix(ink3, base, 0.12),
    '--dsw-alias-label-dimmed': mix(ink, base, 0.44),
    '--dsw-alias-label-document-preview': ink2,
    '--dsw-alias-label-shimmer': mix(ink, base, 0.2),
    '--dsw-alias-label-deep-diving': ink2,
    '--dsw-alias-label-deep-diving-shimmer': mix(ink2, base, 0.3),
    '--dsw-alias-link': ensureContrast(link, base, 4.5),

    // ---- cards / brand
    '--dsw-alias-settings-card-fill': panel,
    '--dsw-alias-settings-card-stroke': alpha(ink, 0.08),
    '--dsw-alias-brand-primary': accent,
    '--dsw-alias-brand-primary-invert': onAccent,
    '--dsw-alias-brand-primary-new-colorprimary-new-color': accent,
    '--dsw-alias-brand-text': onAccent,

    // ---- buttons
    '--dsw-alias-button-contrast-fill': isLight ? ink : mix(ink, base, 0.08),
    '--dsw-alias-button-elevated-fill': raised,
    '--dsw-alias-button-floating-fill': floating,
    '--dsw-alias-button-floating-hover': mix(floating, ink, 0.06),
    '--dsw-alias-button-ghost-active-border': accent,
    '--dsw-alias-button-ghost-active-fill': alpha(accent, 0.1),
    '--dsw-alias-button-ghost-active-hover': alpha(accent, 0.16),
    '--dsw-alias-button-info-fill': accent,
    '--dsw-alias-button-info-hover': mix(accent, ink, 0.14),
    '--dsw-alias-button-primary-dimmed': alpha(accent, 0.55),
    '--dsw-alias-button-primary-fill': accent,
    '--dsw-alias-button-primary-hover': isLight ? mix(accent, ink, 0.14) : mix(accent, '#ffffff', 0.14),
    '--dsw-alias-button-tool-bar-fill': alpha(ink, 0.07),
    '--dsw-alias-button-tool-bar-fill-invisible': alpha(ink, 0),
    '--dsw-alias-button-tool-bar-hover': alpha(ink, 0.13),

    // ---- interaction
    '--dsw-alias-interactive-bg-hover': hover,
    '--dsw-alias-interactive-bg-active': hoverActive,
    '--dsw-alias-interactive-bg-hover-accent': alpha(accent, 0.13),
    '--dsw-alias-interactive-bg-hover-danger': alpha(danger, 0.1),
    '--dsw-alias-interactive-bg-hover-solid': solid,

    // ---- markdown / code
    '--dsw-alias-markdown-code-block': code,
    '--dsw-alias-markdown-code-block-banner': mix(code, ink, 0.04),
    '--dsw-alias-markdown-code-segment-selected': mix(code, ink, 0.09),
    '--dsw-alias-markdown-code-segment-unselected': mix(code, ink, 0.03),
    '--dsw-alias-markdown-inline-code': alpha(ink, 0.07),
    '--dsw-alias-markdown-citation': alpha(accent, 0.16),
    '--dsw-alias-markdown-placeholder': alpha(ink, 0.2),
    '--dsw-alias-markdown-tag': alpha(accent, 0.14),

    // ---- scrollbars
    '--dsw-alias-scrollbar-bg-l1': alpha(ink, 0.1),
    '--dsw-alias-scrollbar-bg-l2': alpha(ink, 0.18),
    '--dsw-alias-scrollbar-hover-l1': alpha(ink, 0.22),
    '--dsw-alias-scrollbar-hover-l2': alpha(ink, 0.3),

    // ---- states
    '--dsw-alias-state-business-primary': business,
    '--dsw-alias-state-business-tertiary': mix(base, business, 0.18),
    '--dsw-alias-state-error-primary': error,
    '--dsw-alias-state-error-secondary': mix(error, base, 0.45),
    '--dsw-alias-state-idle-primary': mix(ink, base, 0.5),
    '--dsw-alias-state-success-primary': success,
    '--dsw-alias-state-success-secondary': mix(success, base, 0.45),
    '--dsw-alias-state-success-tertiary': mix(base, success, 0.18),
    '--dsw-alias-state-warn-primary': warn,
    '--dsw-alias-state-warn-secondary': mix(warn, base, 0.45),
    '--dsw-alias-state-warn-tertiary': mix(base, warn, 0.18),
    '--dsw-alias-state-warn-label': ensureContrast(mix(warn, ink, 0.3), base, 4.5),
    '--dsw-alias-code-diff-added': alpha(success, 0.12),
    '--dsw-alias-code-diff-deleted': alpha(error, 0.1),
    '--dsw-alias-file-diff-added-bg': mix(base, success, 0.1),
    '--dsw-alias-file-diff-added-gutter': mix(base, success, 0.18),
    '--dsw-alias-file-diff-added-marker': success,
    '--dsw-alias-file-diff-deleted-bg': mix(base, error, 0.09),
    '--dsw-alias-file-diff-deleted-gutter': mix(base, error, 0.16),
    '--dsw-alias-file-diff-deleted-marker': error,

    // ---- chrome
    '--dsw-alias-menu-group-header-fill': alpha(ink, 0.04),
    '--dsw-alias-menu-icon': mix(ink, base, 0.32),
    '--dsw-alias-toast-bg': toastBg,
    '--dsw-alias-toast-label': readableOn(toastBg, '#1a1a1a', '#fafafa'),
    '--dsw-alias-tooltip-bg': tooltipBg,
    '--dsw-alias-tooltip-key-bg': code,
    '--dsw-alias-turn-trigger-bg': alpha(ink, 0.05),
    '--dsw-alias-turn-trigger-bg-hover': alpha(ink, 0.09),
    '--dsw-alias-onboarding-accent': accent,
    '--dsw-alias-onboarding-card-fill': alpha(base, 0.94),
    '--dsw-alias-onboarding-secondary-fill': alpha(panel, 0.9),
    '--dsw-alias-onboarding-checkbox-border': alpha(ink, 0.2),
    '--dsw-alias-switch-thumb': readableOn(accent, '#fafafa', '#fafafa'),

    // ---- feature-specific surfaces
    '--dsw-specific-sidebar-fill': mix(base, ink, isLight ? 0.03 : 0.05),
    '--dsw-specific-sidebar-nav-item-hover': mix(base, ink, isLight ? 0.06 : 0.08),
    '--dsw-specific-sidebar-nav-item-active': mix(base, ink, isLight ? 0.1 : 0.12),
    '--dsw-specific-sidebar-nav-item-active-accent': accent,
    '--dsw-specific-menu': panel,
    '--dsw-menu-surface-fill': panel,
    '--dsw-specific-bubble': mix(base, ink, isLight ? 0.04 : 0.06),
    '--dsw-specific-bubble-highlight': mix(base, ink, isLight ? 0.07 : 0.09),
    '--dsw-specific-input-major': mix(base, ink, isLight ? 0.02 : 0.05),
    '--dsw-specific-login-input': mix(base, ink, isLight ? 0.02 : 0.05),
    '--dsw-specific-selector': mix(base, ink, isLight ? 0.05 : 0.07),
    '--dsw-specific-tip': mix(base, ink, isLight ? 0.06 : 0.08),

    // ---- gradients
    '--dsw-linear-gradient-think': `linear-gradient(180deg, ${thinkTint} 20.19%, ${alpha(thinkTint, 0)} 100%)`,
    '--dsw-linear-think-select': `linear-gradient(180deg, ${base} 20.19%, ${alpha(base, 0)} 100%)`,

    // ---- static scales (safety net for aliases this map does not name)
    '--dsw-static-neutral-00': ramp(0),
    '--dsw-static-neutral-50': ramp(0.05),
    '--dsw-static-neutral-100': ramp(0.1),
    '--dsw-static-neutral-200': ramp(0.2),
    '--dsw-static-neutral-400': ramp(0.4),
    '--dsw-static-neutral-700': ramp(0.7),
    '--dsw-static-neutral-800': ramp(0.8),
    '--dsw-static-neutral-850': ramp(0.85),
    '--dsw-static-neutral-1000': ramp(1),
    '--dsw-static-neutral-bluish-00': mix(ramp(0), accent, 0.04),
    '--dsw-static-neutral-bluish-400': mix(ramp(0.4), accent, 0.06),
    '--dsw-static-neutral-bluish-1000': mix(ramp(1), accent, 0.04),
    '--dsw-static-blue-400': mix(accent, '#ffffff', 0.28),
    '--dsw-static-blue-450': isLight ? accent : mix(accent, '#ffffff', 0.12),
    '--dsw-static-blue-500': accent,
    '--dsw-static-blue-600': mix(accent, ink, isLight ? 0.16 : 0.1),

    // ---- syntax highlighting (kept legible on the code surface)
    '--shiki-token-constant': ensureContrast(SYNTAX.constant[isLight ? 0 : 1], code, 4.2),
    '--shiki-token-string': ensureContrast(SYNTAX.string[isLight ? 0 : 1], code, 4.2),
    '--shiki-token-comment': ensureContrast(mix(ink3, code, 0.1), code, 3.5),
    '--shiki-token-keyword': ensureContrast(SYNTAX.keyword[isLight ? 0 : 1], code, 4.2),
    '--shiki-token-parameter': ensureContrast(SYNTAX.parameter[isLight ? 0 : 1], code, 4.2),
    '--shiki-token-function': ensureContrast(SYNTAX.function[isLight ? 0 : 1], code, 4.2),
    '--shiki-token-string-expression': ensureContrast(SYNTAX.stringExpression[isLight ? 0 : 1], code, 4.2),
    '--shiki-token-punctuation': ink2,
    '--shiki-token-link': ensureContrast(SYNTAX.link[isLight ? 0 : 1], code, 4.2),
  }

  // `border` participates through the hairline aliases; keep the seed honest.
  void border
  void format
  void luminance
  void parse

  return tokens
}

/** A palette expanded into `{ light: {...}, dark: {...} }` for the override layer. */
export function buildLayers(palette) {
  return { light: derive(palette.light, 'light'), dark: derive(palette.dark, 'dark') }
}

/** Turn per-mode maps into the `{ token: { light, dark } }` shape `overrideTokens` requires. */
export function toOverrideMap(palette) {
  const { light, dark } = buildLayers(palette)
  const map = {}
  for (const name of TOKEN_NAMES) map[name] = { light: light[name], dark: dark[name] }
  return map
}

/** Contrast audit used by `tools/verify.mjs` and the README tables. */
export function audit(palette) {
  const rows = []
  for (const mode of ['light', 'dark']) {
    const seed = palette[mode]
    const t = derive(seed, mode)
    rows.push({
      mode,
      base: seed.base,
      body: contrast(seed.ink, seed.base),
      secondary: contrast(seed.ink2, seed.base),
      tertiary: contrast(seed.ink3, seed.base),
      link: contrast(t['--dsw-alias-link'], seed.base),
      accent: contrast(seed.accent, seed.base),
      code: contrast(seed.ink, seed.code),
      shikiMin: Math.min(
        ...[
          '--shiki-token-constant', '--shiki-token-string', '--shiki-token-comment', '--shiki-token-keyword',
          '--shiki-token-parameter', '--shiki-token-function', '--shiki-token-string-expression',
          '--shiki-token-link',
        ].map((name) => contrast(t[name], seed.code)),
      ),
    })
  }
  return rows
}
