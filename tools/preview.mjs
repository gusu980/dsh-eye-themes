#!/usr/bin/env node
/**
 * Render `preview/preview.html`: every palette in both modes, painted with the
 * same token names the app reads, inside a mock of the DSH conversation UI.
 * Design check only — the plugin never ships this file.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contrast } from '../src/color.mjs'
import { tune } from '../src/tune.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dump = JSON.parse(readFileSync(join(root, 'lib/palettes.json'), 'utf8'))
const { palettes, pageStops, textStops, defaults } = dump
const PAGE_LABELS = Object.fromEntries(pageStops.map((stop) => [stop.id, stop.label.zh]))
const TEXT_LABELS = Object.fromEntries(textStops.map((stop) => [stop.id, stop.label.zh]))

const esc = (value) => String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])

/** Inline custom properties for one mode of one palette. */
const tokenStyle = (palette, mode, stops = defaults) => {
  const tuned = tune(palette.tokens, palette, stops)
  return Object.entries(tuned)
    .map(([name, pair]) => `${name}:${pair[mode]}`)
    .join(';')
}

function card(palette, mode) {
  const t = (name) => palette.tokens[name][mode]
  const label = palette.name.zh
  return `
<figure class="card" data-palette="${palette.id}" data-mode="${mode}">
  <figcaption>
    <span class="cap-name">${esc(label)} <em>${esc(palette.name.en)}</em></span>
    <span class="cap-mode">${mode === 'light' ? '浅色' : '深色'} · ${esc(palette.tagline.zh)}</span>
  </figcaption>
  <div class="app" style="${tokenStyle(palette, mode)}">
    <div class="side">
      <div class="side-brand">DeepSeek</div>
      <div class="nav is-active">新建会话</div>
      <div class="nav">把结算脚本拆成宽表</div>
      <div class="nav">护眼主题插件</div>
      <div class="side-foot">设置</div>
    </div>
    <div class="main">
      <div class="topbar"><span>护眼主题插件</span><span class="pill">已就绪</span></div>
      <div class="chat">
        <div class="bubble-user">帮我做一个极简的主题插件，5 套护眼配色。</div>
        <div class="msg">
          <p>好的，5 套配色都以 <code>--dsw-*</code> 变量下发，正文对比度都在 10:1 以上。</p>
          <pre><span class="tok-kw">const</span> palettes = [<span class="tok-str">"宣纸"</span>, <span class="tok-str">"豆沙绿"</span>, <span class="tok-str">"月白"</span>]
<span class="tok-com">// 只叠加 token，不注入 CSS</span>
theme.<span class="tok-fn">overrideTokens</span>(<span class="tok-str">"dsh-eye-themes"</span>, tokens)</pre>
          <p class="muted">次要说明文字：次要信息用 label-secondary，避免和高亮抢注意力。</p>
        </div>
        <div class="row">
          <div class="row-title">护眼配色 <span class="hint">在浅色/深色模式之上叠加</span></div>
          <div class="cubes">
            ${palettes
              .map(
                (candidate) => `<div class="cube${candidate.id === palette.id ? ' is-selected' : ''}">
                  <span class="swatch"><i style="background:${candidate.tokens['--dsw-alias-bg-base'][mode]}"></i><i style="background:${candidate.tokens['--dsw-alias-bg-layer-2'][mode]}"></i><i style="background:${candidate.tokens['--dsw-alias-brand-primary'][mode]}"></i></span>
                  <span class="cube-name">${esc(candidate.name.zh)}</span>
                </div>`,
              )
              .join('')}
          </div>
        </div>
        <div class="composer"><span>给 DeepSeek 发送消息…</span><b>发送</b></div>
      </div>
    </div>
  </div>
  <div class="ratios">
    <span>正文 ${palette.audit.find((row) => row.mode === mode).body.toFixed(2)}:1</span>
    <span>次要 ${palette.audit.find((row) => row.mode === mode).secondary.toFixed(2)}:1</span>
    <span>链接 ${palette.audit.find((row) => row.mode === mode).link.toFixed(2)}:1</span>
    <span>代码 ${palette.audit.find((row) => row.mode === mode).code.toFixed(2)}:1</span>
  </div>
  <div class="hex">base ${t('--dsw-alias-bg-base')} · ink ${t('--dsw-alias-label-primary')} · accent ${t('--dsw-alias-brand-primary')}</div>
</figure>`
}

/** Body copy sample on a given surface, with the contrast it actually lands on. */
function cell(palette, mode, stops) {
  const tuned = tune(palette.tokens, palette, stops)
  const bg = tuned['--dsw-alias-bg-base'][mode]
  const ink = tuned['--dsw-alias-label-primary'][mode]
  const secondary = tuned['--dsw-alias-label-secondary'][mode]
  const measured = measureText(tuned, mode)
  return { bg, ink, secondary, measured, hex: ink }
}

/** WCAG ratio between two hex colours, for the caption. */
function measureText(tuned, mode) {
  const bg = tuned['--dsw-alias-bg-base'][mode]
  const ink = tuned['--dsw-alias-label-primary'][mode]
  return contrast(ink, bg)
}

/** Text stops x palettes, dark mode. */
function textGrid() {
  return palettes
    .map((palette) => {
      const cells = textStops
        .map((stop) => {
          const { bg, ink, secondary, measured } = cell(palette, 'dark', { page: defaults.page, text: stop.id })
          return `<div class="tcell" style="background:${bg}">
            <div class="tname">${esc(TEXT_LABELS[stop.id])}</div>
            <div class="tsample" style="color:${ink}">正文 Body ${measured.toFixed(2)}:1</div>
            <div class="tsample2" style="color:${secondary}">次要 secondary</div>
            <div class="thex">${ink}</div>
          </div>`
        })
        .join('')
      return `<div class="trow"><div class="tpal">${esc(palette.name.zh)}<em>${esc(palette.name.en)}</em></div><div class="tcells">${cells}</div></div>`
    })
    .join('')
}

/** Page stops x two modes, one representative palette. */
function pageGrid() {
  const palette = palettes[0]
  return ['dark', 'light']
    .map((mode) => {
      const cells = pageStops
        .map((stop) => {
          const { bg, ink, measured } = cell(palette, mode, { page: stop.id, text: defaults.text })
          return `<div class="tcell" style="background:${bg}">
            <div class="tname">${esc(PAGE_LABELS[stop.id])}</div>
            <div class="tsample" style="color:${ink}">正文 ${measured.toFixed(2)}:1</div>
            <div class="thex">${bg}</div>
          </div>`
        })
        .join('')
      return `<div class="trow"><div class="tpal">${mode === 'dark' ? '深色' : '浅色'}<em>页面亮度</em></div><div class="tcells tcells7">${cells}</div></div>`
    })
    .join('')
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>dsh-eye-themes · 5 套护眼配色预览</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 28px; background: #f4f4f2; font-family: -apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif; color: #1d1d1f; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
  .lede { color: #6b6b70; font-size: 13px; margin: 0 0 22px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(520px, 1fr)); gap: 22px; }
  .card { margin: 0; background: #fff; border-radius: 14px; padding: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.05); }
  figcaption { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 2px 4px 10px; font-size: 13px; }
  .cap-name { font-weight: 600; }
  .cap-name em { font-weight: 400; color: #8a8a90; font-style: normal; margin-left: 4px; }
  .cap-mode { color: #8a8a90; font-size: 12px; }
  .app { display: grid; grid-template-columns: 148px 1fr; height: 330px; border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-base); border: .5px solid var(--dsw-alias-border-l2); }
  .side { background: var(--dsw-specific-sidebar-fill); border-right: .5px solid var(--dsw-alias-border-l1); padding: 10px 8px; display: flex; flex-direction: column; gap: 2px; }
  .side-brand { color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 600; padding: 2px 8px 10px; }
  .nav { color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 6px 8px; border-radius: 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav.is-active { background: var(--dsw-specific-sidebar-nav-item-active); color: var(--dsw-alias-label-primary); }
  .side-foot { margin-top: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; padding: 6px 8px; }
  .main { display: flex; flex-direction: column; min-width: 0; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: .5px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); font-size: 13px; }
  .pill { font-size: 11px; color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-tertiary); border-radius: 999px; padding: 2px 8px; }
  .chat { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
  .bubble-user { align-self: flex-end; max-width: 78%; background: var(--dsw-specific-bubble); color: var(--dsw-alias-label-primary); font-size: 12.5px; line-height: 1.5; padding: 7px 10px; border-radius: 10px; }
  .msg { font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-primary); }
  .msg p { margin: 0 0 6px; }
  .msg code { background: var(--dsw-alias-markdown-inline-code); border-radius: 4px; padding: 1px 4px; font-size: 11.5px; }
  .msg pre { margin: 0 0 6px; background: var(--dsw-alias-markdown-code-block); border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.5; overflow: hidden; color: var(--dsw-alias-label-primary); }
  .tok-kw { color: var(--shiki-token-keyword); } .tok-str { color: var(--shiki-token-string); }
  .tok-com { color: var(--shiki-token-comment); } .tok-fn { color: var(--shiki-token-function); }
  .muted { color: var(--dsw-alias-label-secondary); }
  .row { border-top: .5px solid var(--dsw-alias-border-l2); padding-top: 8px; }
  .row-title { color: var(--dsw-alias-label-primary); font-size: 12.5px; margin-bottom: 6px; }
  .hint { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
  .cubes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .cube { border: .5px solid var(--dsw-alias-border-l4); border-radius: 9px; padding: 6px 6px 4px; text-align: center; }
  .cube.is-selected { background: var(--dsw-alias-bg-module-platform); border-color: var(--dsw-static-neutral-bluish-400); }
  .swatch { display: flex; height: 12px; border-radius: 999px; overflow: hidden; border: .5px solid var(--dsw-alias-border-l2); margin-bottom: 3px; }
  .swatch i { flex: 1; }
  .cube-name { font-size: 10.5px; color: var(--dsw-alias-label-primary); }
  .composer { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--dsw-specific-input-major); border: .5px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 7px 10px; color: var(--dsw-alias-label-dimmed); font-size: 12px; }
  .composer b { color: var(--dsw-alias-brand-text); background: var(--dsw-alias-brand-primary); border-radius: 7px; padding: 3px 10px; font-size: 11.5px; font-weight: 500; }
  .ratios { display: flex; gap: 12px; padding: 8px 4px 2px; color: #6b6b70; font-size: 11px; font-variant-numeric: tabular-nums; }
  .hex { padding: 0 4px 2px; color: #a0a0a6; font-size: 10.5px; font-family: ui-monospace, Menlo, monospace; }
  h2 { font-size: 16px; font-weight: 600; margin: 30px 0 4px; }
  .temps { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
  .trow { display: grid; grid-template-columns: 84px 1fr; gap: 12px; align-items: stretch; }
  .tpal { align-self: center; font-size: 13px; font-weight: 600; }
  .tpal em { display: block; font-weight: 400; color: #8a8a90; font-style: normal; font-size: 11px; }
  .tcells { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
  .tcells7 { grid-template-columns: repeat(7, 1fr); }
  .tcell { border-radius: 10px; padding: 10px 12px; border: .5px solid rgba(128,128,128,.25); }
  .tname { font-size: 10.5px; letter-spacing: .04em; opacity: .55; margin-bottom: 6px; }
  .tsample { font-size: 13px; line-height: 1.45; font-variant-numeric: tabular-nums; }
  .tsample2 { font-size: 12px; line-height: 1.5; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .thex { margin-top: 6px; font-size: 10px; font-family: ui-monospace, Menlo, monospace; opacity: .5; }
</style></head>
<body>
<h1>dsh-eye-themes · 5 套护眼配色</h1>
<p class="lede">每套包含浅色 / 深色两个变体，对应内置的浅色、深色、跟随系统开关；选择后只叠加 <code>--dsw-*</code> token，不注入任何 CSS。以下界面用真实 token 名渲染。</p>
<div class="grid">
${palettes.map((palette) => card(palette, 'light')).join('\n')}
${palettes.map((palette) => card(palette, 'dark')).join('\n')}
</div>

<h2>文字亮度：5 档（深色模式下的正文）</h2>
<p class="lede">滑条 5 档，正文对比度 11.5 → 8.0，「标准」和「柔和」之间补了两档，不会一跳就很淡。每一档都按目标对比度重新落色，层级不会倒挂。</p>
<div class="temps">
${textGrid()}
</div>

<h2>页面亮度：7 档（宣纸，浅色 / 深色各一条）</h2>
<p class="lede">只动背景与卡片，不动强调色；文字会跟着重新落色，所以对比度保持在该档的目标值。浅色页面已经很接近白，往「亮」只能走一小段，往「暗」可以走很远。</p>
<div class="temps">
${pageGrid()}
</div>
</body></html>`

mkdirSync(join(root, 'preview'), { recursive: true })
writeFileSync(join(root, 'preview/preview.html'), html)
console.log(`wrote preview/preview.html (${palettes.length * 2} cards)`)
