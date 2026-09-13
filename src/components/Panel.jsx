import React, { useEffect, useRef, useState } from 'react'
import { useStore, FINISHES, LIGHT_PRESETS, ASPECTS, getAspect } from '../store.js'
import { exportCurrentPNG } from '../lib/exporter.js'
import { exportTimeline } from '../lib/videoExporter.js'
import {
  useTimeline,
  autoCaptureKey,
  updateText,
  deleteText,
  duplicateText,
  setTextPosition,
  addTextKey,
  removeTextKeyNear,
  clearTextKeys,
  textSegmentIndex,
  setTextKeyEase,
  timelineCurve,
  setBackground,
  addBgKeyAtPlayhead,
  bgKeyAtPlayhead,
  updateBgKey,
  deleteBgKeyNear,
  clearBgKeys,
  updateDeviceSeg,
  deleteDeviceSeg,
  setMusicFile,
  updateMusic,
  removeMusic,
  alignText,
  fitTextWidth,
  centerPhone,
} from '../lib/timeline.js'

const ALIGNS = [
  ['left', '⇤', 'Align to the left edge'],
  ['hcenter', '↔', 'Center horizontally'],
  ['right', '⇥', 'Align to the right edge'],
  ['top', '⤒', 'Align to the top edge'],
  ['vcenter', '↕', 'Center vertically'],
  ['bottom', '⤓', 'Align to the bottom edge'],
]

function MusicSection() {
  const music = useStore((s) => s.music)
  const input = useRef(null)
  const [loading, setLoading] = useState(false)
  const importFile = async (file) => {
    if (!file) return
    setLoading(true)
    try {
      await setMusicFile(file)
    } catch (err) {
      alert('Could not load that audio file: ' + err.message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <Section title="Music">
      <div className="btn-row">
        <button className="btn" onClick={() => input.current.click()} disabled={loading}>
          {loading ? 'Loading…' : music ? 'Replace music…' : 'Import music…'}
        </button>
        {music && (
          <button className="btn ghost" onClick={removeMusic}>
            Remove
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg"
        hidden
        onChange={(e) => {
          importFile(e.target.files[0])
          e.target.value = ''
        }}
      />
      {!music && <div className="hint">or drop an audio file anywhere · included in MP4 exports</div>}
      {music && (
        <>
          <div className="hint">
            ♫ {music.name} · {music.dur.toFixed(1)}s — drag the block on the MUSIC lane to place it, edges to trim
          </div>
          <Row label="Volume">
            <Slider value={music.volume} onChange={(v) => updateMusic({ volume: v })} min={0} max={1} step={0.05} />
          </Row>
          <Row label="Fade in">
            <Slider value={music.fadeIn} onChange={(v) => updateMusic({ fadeIn: v })} min={0} max={5} step={0.1} suffix="s" />
          </Row>
          <Row label="Fade out">
            <Slider value={music.fadeOut} onChange={(v) => updateMusic({ fadeOut: v })} min={0} max={5} step={0.1} suffix="s" />
          </Row>
          <Row label="Start at">
            <input
              className="num"
              type="number"
              min={0}
              step={0.1}
              value={music.offset}
              onChange={(e) => updateMusic({ offset: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Row>
        </>
      )}
    </Section>
  )
}
import { bgAt, DEVICE_ANIMS } from '../lib/scenes.js'
import { displayText } from '../lib/textRender.js'
import {
  LANGUAGES,
  aiApi,
  translateTexts,
  estimateTranslate,
  copyVariants,
  estimateStoryboard,
  generateStoryboard,
  exportAllLocales,
} from '../lib/ai.js'

const fmtUsd = (usd) => (usd < 0.01 ? '< $0.01' : `≈ $${usd.toFixed(2)}`)

function ClaudeSection() {
  const s = useStore()
  const set = s.set
  const api = aiApi()
  const [hasKey, setHasKey] = useState(null)
  const [langs, setLangs] = useState(['de', 'fr', 'es'])
  const [context, setContext] = useState('')
  const [msg, setMsg] = useState('')
  const [brief, setBrief] = useState('')
  const [seconds, setSeconds] = useState(15)
  const [batch, setBatch] = useState(null)

  useEffect(() => {
    if (api) api.hasKey().then((k) => setHasKey(!!k.active))
  }, [s.showSettings]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLang = (code) => setLangs((l) => (l.includes(code) ? l.filter((c) => c !== code) : [...l, code]))

  const runTranslate = async () => {
    setMsg('')
    try {
      const est = await estimateTranslate(langs, context)
      if (!est) return setMsg('Add some text layers and pick languages first')
      if (!est.ok) return setMsg(est.error)
      if (!window.confirm(`Translate ${s.texts.length} text layers into ${langs.length} languages with ${est.model}?\nEstimated cost ${fmtUsd(est.usd)} (billed to your key).`)) return
      const usage = await translateTexts(langs, context)
      setMsg(`Done — ${usage?.input_tokens ?? '?'} in / ${usage?.output_tokens ?? '?'} out tokens. Switch languages below.`)
    } catch (err) {
      setMsg(err.message)
    }
  }

  const runStoryboard = async () => {
    setMsg('')
    // the brief drives the plan; with only app context filled in, use that
    const text = brief.trim() || context.trim()
    if (!text) {
      setMsg('⚠ Write a short brief first — what the app is and what this video should make people feel or do.')
      document.querySelector('.storyboard-brief')?.focus()
      return
    }
    try {
      const est = await estimateStoryboard(text, seconds)
      if (est && !est.ok) return setMsg(est.error)
      const hasStuff = s.texts.length || s.bgKeys.length || (s.deviceSegs && s.deviceSegs.length)
      const warn = hasStuff ? '\nThis replaces the current scenes, texts and camera keyframes (⌘Z undoes it).' : ''
      if (!window.confirm(`Draft a ${seconds}s storyboard with ${est?.model || 'Claude'}?\nEstimated cost ${fmtUsd(est?.usd || 0)}.${warn}`)) return
      const res = await generateStoryboard(text, seconds, brief.trim() ? context : '')
      setMsg(`Storyboard "${res.plan.title}" — ${res.plan.scenes.length} scenes. Review and tweak anything; ⌘Z brings the old timeline back.`)
    } catch (err) {
      setMsg(err.message)
    }
  }

  const runBatch = async () => {
    setMsg('')
    setBatch({ p: 0, code: 'base' })
    try {
      const r = await exportAllLocales((p, code) => setBatch({ p, code }))
      setMsg(r.canceled ? 'Cancelled' : `Exported ${r.count} videos to ${r.dir}`)
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBatch(null)
    }
  }

  return (
    <Section title="AI assistant">
      {!api ? (
        <div className="hint">AI features run in the desktop app.</div>
      ) : (
        <>
          {hasKey === false && (
            <div className="btn-row tight">
              <button className="btn primary" onClick={() => set({ showSettings: true })}>Set up an AI provider…</button>
            </div>
          )}
          {s.aiBusy && <div className="ai-busy">{s.aiBusy}</div>}

          <div className="sub-label">App context (optional, helps every request)</div>
          <textarea
            className="text-input"
            rows={2}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="e.g. Coachly — a marketplace where coaches sell sessions. Audience: fitness coaches."
            spellCheck={false}
          />

          <div className="sub-label">Localize</div>
          <div className="lang-chips">
            {LANGUAGES.map((l) => (
              <button key={l.code} className={`lang-chip ${langs.includes(l.code) ? 'active' : ''}`} onClick={() => toggleLang(l.code)}>
                {l.name}
              </button>
            ))}
          </div>
          <div className="btn-row tight">
            <button className="btn primary" disabled={!hasKey || !!s.aiBusy || !langs.length || !s.texts.length} onClick={runTranslate}>
              Translate all text layers…
            </button>
          </div>
          {s.locales.length > 0 && (
            <>
              <Row label="Show">
                <select value={s.activeLocale} onChange={(e) => set({ activeLocale: e.target.value })}>
                  <option value="base">Original</option>
                  {s.locales.map((l) => (
                    <option key={l.code} value={l.code}>{l.name}</option>
                  ))}
                </select>
              </Row>
              <div className="btn-row tight">
                <button className="btn" disabled={!!batch || s.exportingVideo} onClick={runBatch}>
                  {batch ? `Exporting ${batch.code}… ${Math.round(batch.p * 100)}%` : `Export all ${s.locales.length + 1} languages…`}
                </button>
              </div>
              <div className="hint">edits in the Text section apply to the language shown; translations are saved in the project</div>
            </>
          )}

          <div className="sub-label">AI storyboard · brief</div>
          <textarea
            className="text-input storyboard-brief"
            rows={3}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="e.g. 15s TikTok ad — show how fast a coach can set up paid sessions, end on the app name"
            spellCheck={false}
          />
          {!brief.trim() && context.trim() && <div className="hint">no brief yet — the app context above will be used</div>}
          <Row label="Length">
            <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              {[10, 15, 20, 30].map((v) => (
                <option key={v} value={v}>{v}s</option>
              ))}
            </select>
          </Row>
          <div className="btn-row tight">
            <button className="btn primary" disabled={!hasKey || !!s.aiBusy} onClick={runStoryboard}>
              Draft storyboard…
            </button>
          </div>
          <div className="hint">
            Claude gets your brief plus sampled frames from each recording and returns scenes, cut points, titles and reveals as an editable timeline.
          </div>
          {msg && <div className={`hint ${/^(Done|Storyboard|Exported)/.test(msg) ? 'ok' : 'warn'}`}>{msg}</div>}
        </>
      )}
    </Section>
  )
}

function DeviceSection({ seg }) {
  const up = (patch) => updateDeviceSeg(seg.id, patch)
  const length = useTimeline((t) => t.length)
  return (
    <Section title="Device scene" defaultOpen>
      <div className="hint">the phone is on stage from {seg.start.toFixed(1)}s to {seg.end.toFixed(1)}s</div>
      <Row label="Enter">
        <select value={seg.intro} onChange={(e) => up({ intro: e.target.value })}>
          {Object.entries(DEVICE_ANIMS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Row>
      {seg.intro !== 'cut' && (
        <Row label="Enter time">
          <Slider value={seg.inDur} onChange={(v) => up({ inDur: v })} min={0.1} max={2} step={0.05} suffix="s" />
        </Row>
      )}
      <Row label="Exit">
        <select value={seg.outro} onChange={(e) => up({ outro: e.target.value })}>
          {Object.entries(DEVICE_ANIMS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Row>
      {seg.outro !== 'cut' && (
        <Row label="Exit time">
          <Slider value={seg.outDur} onChange={(v) => up({ outDur: v })} min={0.1} max={2} step={0.05} suffix="s" />
        </Row>
      )}
      <Row label="Start">
        <input className="num" type="number" min={0} max={length} step={0.1} value={seg.start} onChange={(e) => up({ start: Math.min(seg.end - 0.2, Math.max(0, Number(e.target.value) || 0)) })} />
      </Row>
      <Row label="End">
        <input className="num" type="number" min={0} max={length} step={0.1} value={seg.end} onChange={(e) => up({ end: Math.max(seg.start + 0.2, Math.min(length, Number(e.target.value) || 0)) })} />
      </Row>
      <button className="btn ghost danger" onClick={() => deleteDeviceSeg(seg.id)} title="⌫">
        Remove this phone segment
      </button>
    </Section>
  )
}
import CurveEditor from './CurveEditor.jsx'
import { DEFAULT_CURVE } from '../lib/bezier.js'
import { controlsRef } from '../lib/refs.js'
import { setScreenFile } from '../App.jsx'
import { FAMILIES, ANIMS, OUTS, EASINGS, STYLES, STYLE_PROPS, SHAPES, resolveAt } from '../lib/textRender.js'
import { loadFont, fontNameFromFile, fontExt } from '../lib/fonts.js'

// user-saved text styles live in localStorage (they're personal, not per-project)
function loadUserStyles() {
  try {
    return JSON.parse(localStorage.getItem('spinshot.textStyles') || '[]')
  } catch {
    return []
  }
}
function persistUserStyles(list) {
  try {
    localStorage.setItem('spinshot.textStyles', JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

function TextSection({ tx: raw }) {
  const up = (patch) => updateText(raw.id, patch)
  const length = useTimeline((t) => t.length)
  const playhead = useTimeline((t) => Math.min(t.t, t.length))
  const locale = useStore((s) => s.activeLocale)
  const locales = useStore((s) => s.locales)
  const aiBusy = useStore((s) => s.aiBusy)
  const shownText = displayText(raw, locale)
  const setShownText = (value) =>
    locale === 'base' ? up({ text: value }) : up({ i18n: { ...(raw.i18n || {}), [locale]: value } })
  const [variants, setVariants] = useState(null)
  const [copyErr, setCopyErr] = useState('')
  const askCopy = async (mode) => {
    setCopyErr('')
    try {
      setVariants(await copyVariants(shownText, mode))
    } catch (err) {
      setCopyErr(err.message)
    }
  }
  // position/size shown for the playhead (keyed texts animate between keys)
  const tx = resolveAt(raw, Math.min(Math.max(playhead, raw.start), raw.end))
  const keyCount = raw.keys?.length || 0
  const keyHere = keyCount > 0 && raw.keys.some((k) => Math.abs(k.t - playhead) < 0.06)
  const fonts = useStore((s) => s.fonts)
  const set = useStore((s) => s.set)
  const fontInput = useRef(null)
  const [userStyles, setUserStyles] = useState(loadUserStyles)
  const perUnit = tx.anim === 'words' || tx.anim === 'chars'

  const saveStyle = () => {
    const name = window.prompt('Name this style', 'My style')
    if (!name) return
    const props = {}
    for (const k of STYLE_PROPS) if (k in tx) props[k] = tx[k]
    const next = [...userStyles.filter((s) => s.name !== name), { name, props }]
    setUserStyles(next)
    persistUserStyles(next)
  }
  const removeStyle = (name) => {
    const next = userStyles.filter((s) => s.name !== name)
    setUserStyles(next)
    persistUserStyles(next)
  }

  const importFont = async (file) => {
    if (!file) return
    const id = `f${Date.now().toString(36)}`
    const name = fontNameFromFile(file)
    const src = URL.createObjectURL(file)
    try {
      await loadFont(id, name, src)
      set({ fonts: [...fonts, { id, name, src, ext: fontExt(file) }] })
      up({ family: `custom:${id}` })
    } catch (err) {
      alert('Could not load that font: ' + err.message)
    }
  }

  return (
    <Section title="Text" defaultOpen>
      {locale !== 'base' && (
        <div className="hint">
          editing the <span className="locale-badge">{(locales.find((l) => l.code === locale)?.name || locale).toUpperCase()}</span> version · original: {raw.text.split('\n')[0]}
        </div>
      )}
      <textarea
        className="text-input"
        rows={2}
        value={shownText}
        onChange={(e) => setShownText(e.target.value)}
        placeholder="Your text…"
        spellCheck={false}
      />
      {aiApi() && (
        <>
          <div className="btn-row tight">
            <button className="btn ghost" disabled={!!aiBusy || !shownText.trim()} onClick={() => askCopy('punchier')} title="Ask Claude for a punchier version">✦ Punchier</button>
            <button className="btn ghost" disabled={!!aiBusy || !shownText.trim()} onClick={() => askCopy('shorter')} title="Ask Claude for a shorter version">✦ Shorter</button>
            <button className="btn ghost" disabled={!!aiBusy || !shownText.trim()} onClick={() => askCopy('alternatives')} title="Ask Claude for 5 different angles">✦ Ideas</button>
          </div>
          {aiBusy && <div className="ai-busy">{aiBusy}</div>}
          {copyErr && <div className="hint">{copyErr}</div>}
          {variants && (
            <div className="variants">
              {variants.map((v, i) => (
                <div key={i} className="variant">
                  <span>{v}</span>
                  <button className="btn" onClick={() => { setShownText(v); setVariants(null) }}>Use</button>
                </div>
              ))}
              <button className="btn ghost" onClick={() => setVariants(null)}>Dismiss</button>
            </div>
          )}
        </>
      )}
      <div className="style-row">
        {Object.entries(STYLES).map(([key, st]) => {
          const { label, ...props } = st
          return (
            <button key={key} className="btn" onClick={() => up(props)} title={`Apply the ${label} style`}>
              {label}
            </button>
          )
        })}
        {userStyles.map((st) => (
          <span key={st.name} className="style-chip">
            <button className="btn" onClick={() => up(st.props)} title="Apply your saved style">
              {st.name}
            </button>
            <button className="chip-x" onClick={() => removeStyle(st.name)} title="Remove this saved style">
              ×
            </button>
          </span>
        ))}
        <button className="btn ghost" onClick={saveStyle} title="Save this text's look as a reusable style">
          Save style…
        </button>
      </div>
      <Row label="Font">
        <select value={tx.family} onChange={(e) => up({ family: e.target.value })}>
          {Object.entries(FAMILIES).map(([k, f]) => (
            <option key={k} value={k}>{f.label}</option>
          ))}
          {fonts.map((f) => (
            <option key={f.id} value={`custom:${f.id}`}>{f.name}</option>
          ))}
        </select>
      </Row>
      <div className="btn-row tight">
        <button className="btn ghost" onClick={() => fontInput.current.click()} title="Import a .ttf / .otf / .woff2 brand font — it's saved inside the project">
          Import font…
        </button>
        <button className="btn ghost" onClick={() => duplicateText(tx.id)} title="⌘D">
          Duplicate
        </button>
      </div>
      <input
        ref={fontInput}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/*"
        hidden
        onChange={(e) => {
          importFont(e.target.files[0])
          e.target.value = ''
        }}
      />
      <Row label="Weight">
        <select value={tx.weight} onChange={(e) => up({ weight: Number(e.target.value) })}>
          {[300, 400, 500, 600, 700, 800].map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </Row>
      <Row label="Size">
        <Slider value={Math.round(tx.size * 1000) / 10} onChange={(v) => setTextPosition(raw.id, { size: v / 100 })} min={1.5} max={20} step={0.25} suffix="%" />
      </Row>
      <Row label="Tracking">
        <Slider value={tx.tracking} onChange={(v) => up({ tracking: v })} min={-0.1} max={0.3} step={0.005} />
      </Row>
      <Row label="Leading">
        <Slider value={tx.lineHeight} onChange={(v) => up({ lineHeight: v })} min={0.8} max={1.8} step={0.05} />
      </Row>
      <Segmented
        options={[['solid', 'Solid color'], ['gradient', 'Gradient']]}
        value={tx.fill || 'solid'}
        onChange={(v) => up({ fill: v })}
      />
      <Row label={tx.fill === 'gradient' ? 'From' : 'Color'}>
        <label className="color-field">
          <input type="color" value={tx.color} onChange={(e) => up({ color: e.target.value })} />
          <span className="color-val">{tx.color}</span>
        </label>
      </Row>
      {tx.fill === 'gradient' && (
        <>
          <Row label="To">
            <label className="color-field">
              <input type="color" value={tx.color2 || '#635bff'} onChange={(e) => up({ color2: e.target.value })} />
              <span className="color-val">{tx.color2 || '#635bff'}</span>
            </label>
          </Row>
          <Row label="Angle">
            <Slider value={tx.gradAngle ?? 90} onChange={(v) => up({ gradAngle: v })} min={0} max={360} step={5} suffix="°" />
          </Row>
        </>
      )}
      <Row label="Shadow">
        <Slider value={tx.shadow ?? 0} onChange={(v) => up({ shadow: v })} min={0} max={1} step={0.05} />
      </Row>
      <Row label="Callout">
        <select value={tx.shape || 'none'} onChange={(e) => up({ shape: e.target.value })}>
          {Object.entries(SHAPES).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Row>
      {(tx.shape || 'none') !== 'none' && (
        <>
          <Row label="Shape color">
            <label className="color-field">
              <input type="color" value={tx.bgColor || '#635bff'} onChange={(e) => up({ bgColor: e.target.value })} />
              <span className="color-val">{tx.bgColor || '#635bff'}</span>
            </label>
          </Row>
          <Row label="Opacity">
            <Slider value={tx.bgAlpha ?? 1} onChange={(v) => up({ bgAlpha: v })} min={0.1} max={1} step={0.05} />
          </Row>
          {tx.shape !== 'dot' && (
            <Row label="Padding">
              <Slider value={tx.pad ?? 0.5} onChange={(v) => up({ pad: v })} min={0.1} max={1.5} step={0.05} />
            </Row>
          )}
          {tx.shape === 'arrow' && (
            <>
              <Row label="Arrow X">
                <Slider value={Math.round((tx.ax ?? 0.5) * 100)} onChange={(v) => up({ ax: v / 100 })} min={0} max={100} step={0.5} suffix="%" />
              </Row>
              <Row label="Arrow Y">
                <Slider value={Math.round((tx.ay ?? 0.45) * 100)} onChange={(v) => up({ ay: v / 100 })} min={0} max={100} step={0.5} suffix="%" />
              </Row>
              <div className="hint">or drag the arrow tip (the dot) in the viewport</div>
            </>
          )}
          {tx.shape === 'dot' && <div className="hint">leave the text empty for a plain tap marker</div>}
        </>
      )}
      <Segmented
        options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]}
        value={tx.align}
        onChange={(v) => up({ align: v })}
      />
      <label className="checkline">
        <input type="checkbox" checked={!!tx.uppercase} onChange={(e) => up({ uppercase: e.target.checked })} />
        uppercase
      </label>
      <Row label="X">
        <Slider value={Math.round(tx.x * 100)} onChange={(v) => setTextPosition(raw.id, { x: v / 100 })} min={0} max={100} step={0.5} suffix="%" />
      </Row>
      <Row label="Y">
        <Slider value={Math.round(tx.y * 100)} onChange={(v) => setTextPosition(raw.id, { y: v / 100 })} min={0} max={100} step={0.5} suffix="%" />
      </Row>
      <div className="hint">or drag the text directly in the viewport</div>
      <Row label="Align">
        <div className="align-row">
          {ALIGNS.map(([mode, glyph, title]) => (
            <button key={mode} className="btn ghost align-btn" onClick={() => alignText(raw.id, mode)} title={title}>
              {glyph}
            </button>
          ))}
          <button className="btn ghost align-btn fit" onClick={() => fitTextWidth(raw.id)} title="Shrink the size until the text fits the frame width">
            Fit
          </button>
        </div>
      </Row>
      <div className="btn-row tight">
        <button
          className={`btn ghost ${keyHere ? 'active-key' : ''}`}
          onClick={() => addTextKey(raw.id)}
          title="Keyframe the position and size at the playhead — move the playhead, move the text, and it animates between keys"
        >
          {keyHere ? '◆ Keyed here' : '◇ Key position'}
        </button>
        <button className="btn ghost" disabled={!keyCount} onClick={() => removeTextKeyNear(raw.id, playhead)} title="Remove the position key nearest the playhead">
          − Key
        </button>
        <button className="btn ghost" disabled={!keyCount} onClick={() => clearTextKeys(raw.id)} title="Remove all position keys (keeps the current position)">
          Clear
        </button>
      </div>
      {keyCount > 0 && (
        <div className="hint">
          {keyCount} position {keyCount === 1 ? 'key' : 'keys'} — moving or resizing the text now edits the key at the playhead
        </div>
      )}
      {keyCount >= 2 && (() => {
        const seg = textSegmentIndex(raw, playhead)
        const from = raw.keys[seg]
        const to = raw.keys[seg + 1]
        return (
          <>
            <div className="sub-label">
              Move easing · key {seg + 1} → {seg + 2} ({from.t.toFixed(1)}s → {to.t.toFixed(1)}s)
            </div>
            <CurveEditor value={from.ease || DEFAULT_CURVE} onChange={(c) => setTextKeyEase(raw.id, seg, c)} />
            <div className="hint">drag the handles or pick a preset · applies to the move the playhead is in</div>
          </>
        )
      })()}

      <Row label="Start">
        <input
          className="num"
          type="number"
          min={0}
          max={length}
          step={0.1}
          value={tx.start}
          onChange={(e) => up({ start: Math.min(tx.end - 0.2, Math.max(0, Number(e.target.value) || 0)) })}
        />
      </Row>
      <Row label="End">
        <input
          className="num"
          type="number"
          min={0}
          max={length}
          step={0.1}
          value={tx.end}
          onChange={(e) => up({ end: Math.max(tx.start + 0.2, Math.min(length, Number(e.target.value) || 0)) })}
        />
      </Row>

      <Row label="Reveal">
        <select value={tx.anim} onChange={(e) => up({ anim: e.target.value })}>
          {Object.entries(ANIMS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Row>
      {tx.anim !== 'none' && (
        <Row label="Duration">
          <Slider value={tx.inDur} onChange={(v) => up({ inDur: v })} min={0.1} max={2.5} step={0.05} suffix="s" />
        </Row>
      )}
      {perUnit && (
        <Row label="Stagger">
          <Slider value={tx.stagger} onChange={(v) => up({ stagger: v })} min={0} max={0.25} step={0.01} suffix="s" />
        </Row>
      )}
      <Row label="Exit">
        <select value={tx.outAnim} onChange={(e) => up({ outAnim: e.target.value })}>
          {Object.entries(OUTS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Row>
      {tx.outAnim !== 'none' && (
        <Row label="Exit time">
          <Slider value={tx.outDur} onChange={(v) => up({ outDur: v })} min={0.1} max={2} step={0.05} suffix="s" />
        </Row>
      )}
      <Row label="Easing">
        <select value={tx.easing} onChange={(e) => up({ easing: e.target.value })}>
          {Object.entries(EASINGS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </Row>
      <button className="btn ghost danger" onClick={() => deleteText(tx.id)} title="⌫">
        Delete text
      </button>
    </Section>
  )
}

// In the dockable workspace each section is its own panel: a Panel rendered
// with `only` shows just the matching section, flat (no accordion header).
const OnlyCtx = React.createContext(null)
const SECTION_KEYS = {
  Screen: 'screen',
  Device: 'device',
  Camera: 'camera',
  Background: 'background',
  Music: 'music',
  'AI assistant': 'ai',
  'Light & floor': 'light',
  Export: 'export',
  'Export video': 'exportvideo',
  Text: 'properties',
  'Device scene': 'properties',
}
export const PANEL_TITLES = {
  properties: 'Properties',
  screen: 'Screen',
  device: 'Device',
  camera: 'Camera',
  background: 'Background',
  music: 'Music',
  ai: 'AI assistant',
  light: 'Light & floor',
  export: 'Export image',
  exportvideo: 'Export video',
}

function Section({ title, defaultOpen = false, children }) {
  const only = React.useContext(OnlyCtx)
  const [open, setOpen] = useState(defaultOpen)
  if (only) {
    if (SECTION_KEYS[title] !== only) return null
    return (
      <div className="dock-section">
        {(title === 'Text' || title === 'Device scene') && <div className="dock-section-title">{title}</div>}
        {children}
      </div>
    )
  }
  return (
    <div className={`section ${open ? 'open' : 'collapsed'}`}>
      <button className="section-title" onClick={() => setOpen(!open)} aria-expanded={open}>
        {title}
        <span className="chevron" aria-hidden="true">
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3.5l3 3 3-3" />
          </svg>
        </span>
      </button>
      <div className="section-body">
        <div className="section-body-inner">{children}</div>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <div className="row-control">{children}</div>
    </div>
  )
}

// After-Effects-style property value: drag the number to scrub (⇧ = coarse,
// ⌥ = fine), double-click to type. A hairline track shows where it sits in range.
function Slider({ value, onChange, min, max, step = 1, suffix = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const decimals = Math.max(0, Math.min(3, Math.ceil(-Math.log10(step || 1))))
  const clampRound = (v) => {
    const r = Math.round(Math.min(max, Math.max(min, v)) / step) * step
    return Number(r.toFixed(decimals))
  }
  const p = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const startScrub = (e, absolute) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    const track = el.closest('.scrub').querySelector('.scrub-track')
    const startX = e.clientX
    const startV = value
    let moved = false
    const apply = (ev) => {
      const mult = ev.shiftKey ? 4 : ev.altKey ? 0.2 : 1
      if (absolute) {
        const r = track.getBoundingClientRect()
        onChange(clampRound(min + ((ev.clientX - r.left) / r.width) * (max - min)))
      } else {
        const perPx = ((max - min) / 220) * mult
        onChange(clampRound(startV + (ev.clientX - startX) * perPx))
      }
    }
    const mv = (ev) => {
      if (Math.abs(ev.clientX - startX) > 2) moved = true
      if (moved) apply(ev)
    }
    const up = (ev) => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('scrubbing')
      if (absolute && !moved) apply(ev)
    }
    document.body.classList.add('scrubbing')
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
  }
  const commit = () => {
    const n = parseFloat(draft)
    if (!Number.isNaN(n)) onChange(clampRound(n))
    setEditing(false)
  }
  return (
    <div className="scrub">
      <div className="scrub-track" onPointerDown={(e) => startScrub(e, true)}>
        <div className="scrub-fill" style={{ width: `${p * 100}%` }} />
      </div>
      {editing ? (
        <input
          className="scrub-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
            e.stopPropagation()
          }}
        />
      ) : (
        <span
          className="scrub-val"
          onPointerDown={(e) => startScrub(e, false)}
          onDoubleClick={() => {
            setDraft(String(value))
            setEditing(true)
          }}
          title="Drag to scrub · double-click to type · ⇧ coarse · ⌥ fine"
        >
          {Number(value).toFixed(decimals)}
          {suffix && <em>{suffix}</em>}
        </span>
      )}
    </div>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map(([key, label]) => (
        <button key={key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Panel({ width, only = null }) {
  const s = useStore()
  const set = s.set
  const screenInput = useRef(null)
  const bgInput = useRef(null)
  const [busy, setBusy] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const readFile = (file, cb) => {
    const r = new FileReader()
    r.onload = () => cb(r.result)
    r.readAsDataURL(file)
  }

  const doExport = async () => {
    setBusy(true)
    setSavedMsg('')
    try {
      const res = await exportCurrentPNG()
      if (res?.saved) setSavedMsg(`Saved ${res.w}×${res.h}`)
    } catch (err) {
      setSavedMsg('Export failed: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const selectedTextId = useTimeline((t) => t.selectedText)
  const selectedDeviceId = useTimeline((t) => t.selectedDevice)
  const tlEasing = useTimeline((t) => t.easing)
  const playhead = useTimeline((t) => Math.min(t.t, t.length))
  const selText = selectedTextId ? s.texts.find((tx) => tx.id === selectedTextId) : null
  const selSeg = selectedDeviceId ? (s.deviceSegs || []).find((x) => x.id === selectedDeviceId) : null
  // background as it is at the playhead (keyed backgrounds crossfade)
  const bg = s.bgKeys.length ? bgAt(s.bgKeys, playhead, s) : { bgType: s.bgType, c1: s.bgColor1, c2: s.bgColor2, bgImage: s.bgImage }
  const bgKeyHere = s.bgKeys.length ? bgKeyAtPlayhead() : null

  return (
    <OnlyCtx.Provider value={only}>
    <div className={`panel ${only ? 'dock' : ''}`} style={width ? { width } : undefined}>
      {only === 'properties' && !selText && !selSeg && (
        <div className="dock-empty">
          <div>Nothing selected</div>
          <div className="hint">Click a text, badge or phone segment on the timeline (or in the composition) to edit it here.</div>
        </div>
      )}
      {selText && <TextSection key={selText.id} tx={selText} />}
      {selSeg && <DeviceSection key={selSeg.id} seg={selSeg} />}
      <Section title="Screen">
        <div className="btn-row">
          <button className="btn" onClick={() => screenInput.current.click()}>Choose image / video…</button>
          {s.screenSrc && (
            <button
              className="btn ghost"
              onClick={() => {
                set({ screenSrc: null, screenType: 'image', videoTrim: 0, clips: [], media: [] })
                useTimeline.setState({ selectedClip: null })
              }}
            >
              Clear
            </button>
          )}
        </div>
        <input
          ref={screenInput}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => e.target.files[0] && setScreenFile(e.target.files[0], set)}
        />
        <div className="hint">or drag &amp; drop anywhere — screenshots and screen recordings both work</div>
        {s.screenType === 'video' && s.media.length > 0 && (
          <>
            <div className="hint">
              {s.media.length === 1
                ? `recording is ${(s.media[0].dur || 0).toFixed(1)}s`
                : `${s.media.length} recordings · ${s.media.reduce((a, m) => a + (m.dur || 0), 0).toFixed(1)}s of footage`}
              {' '}— cut, trim and speed it up on the video lane (S splits at the playhead, drag clip edges to trim, ⌫ deletes the selected clip).
              Drop another recording to append it.
            </div>
            <label className="checkline">
              <input type="checkbox" checked={s.bakeTrim} onChange={(e) => set({ bakeTrim: e.target.checked })} />
              save projects with only the edited video (smaller file)
            </label>
          </>
        )}
      </Section>

      <Section title="Device" defaultOpen>
        <div className="swatches">
          {Object.entries(FINISHES).map(([key, f]) => (
            <button
              key={key}
              title={f.label}
              className={`swatch ${s.finish === key ? 'active' : ''}`}
              style={{ background: f.frame }}
              onClick={() => set({ finish: key })}
            />
          ))}
        </div>
        <Row label="Tilt"><Slider value={s.rotX} onChange={(v) => { set({ rotX: v }); autoCaptureKey() }} min={-45} max={45} suffix="°" /></Row>
        <Row label="Turn"><Slider value={s.rotY} onChange={(v) => { set({ rotY: v }); autoCaptureKey() }} min={-180} max={180} suffix="°" /></Row>
        <Row label="Roll"><Slider value={s.rotZ} onChange={(v) => { set({ rotZ: v }); autoCaptureKey() }} min={-45} max={45} suffix="°" /></Row>
        <Row label="Move X"><Slider value={s.posX ?? 0} onChange={(v) => { set({ posX: v }); autoCaptureKey() }} min={-2} max={2} step={0.01} /></Row>
        <Row label="Move Y"><Slider value={s.posY ?? 0} onChange={(v) => { set({ posY: v }); autoCaptureKey() }} min={-2} max={2} step={0.01} /></Row>
        <Row label="Move Z"><Slider value={s.posZ ?? 0} onChange={(v) => { set({ posZ: v }); autoCaptureKey() }} min={-2} max={2} step={0.01} /></Row>
        <div className="btn-row tight">
          <button className="btn ghost" onClick={centerPhone} title="Move the phone back to the middle of the frame (records a keyframe when auto-key is on)">
            ↔ Center phone
          </button>
        </div>
        <div className="hint">or hold ⌥ and drag the phone in the viewport · position animates through keyframes like rotation</div>
      </Section>

      <Section title="Camera">
        <Row label="Lens">
          <Slider value={s.fov} onChange={(v) => { set({ fov: v }); autoCaptureKey() }} min={12} max={75} suffix="°" />
        </Row>
        <div className="hint">low = flat product shot · high = dramatic</div>
        <button className="btn ghost" onClick={() => controlsRef.current?.reset()}>Reset camera</button>
        <div className="sub-label">Keyframe easing</div>
        <CurveEditor value={timelineCurve(tlEasing)} onChange={(c) => useTimeline.setState({ easing: c })} />
        <div className="hint">how camera, rotation and position moves accelerate between keyframes</div>
      </Section>

      <Section title="Background">
        <Segmented
          options={[['transparent', 'None'], ['solid', 'Solid'], ['gradient', 'Gradient'], ['image', 'Image']]}
          value={bg.bgType}
          onChange={(v) => setBackground({ bgType: v })}
        />
        {(bg.bgType === 'solid' || bg.bgType === 'gradient') && (
          <Row label={bg.bgType === 'gradient' ? 'Top' : 'Color'}>
            <label className="color-field">
              <input type="color" value={bg.c1} onChange={(e) => setBackground({ bgColor1: e.target.value })} />
              <span className="color-val">{bg.c1}</span>
            </label>
          </Row>
        )}
        {bg.bgType === 'gradient' && (
          <Row label="Bottom">
            <label className="color-field">
              <input type="color" value={bg.c2} onChange={(e) => setBackground({ bgColor2: e.target.value })} />
              <span className="color-val">{bg.c2}</span>
            </label>
          </Row>
        )}
        {bg.bgType === 'image' && (
          <>
            <button className="btn" onClick={() => bgInput.current.click()}>Choose background…</button>
            <input
              ref={bgInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files[0] && readFile(e.target.files[0], (src) => setBackground({ bgImage: src }))}
            />
          </>
        )}
        <div className="btn-row tight">
          <button
            className={`btn ghost ${bgKeyHere ? 'active-key' : ''}`}
            onClick={() => addBgKeyAtPlayhead()}
            title="Keyframe the background at the playhead — scenes can each have their own, crossfading between keys"
          >
            {bgKeyHere ? '◆ Keyed here' : '◇ Key background'}
          </button>
          <button className="btn ghost" disabled={!s.bgKeys.length} onClick={() => deleteBgKeyNear(playhead)} title="Remove the background key nearest the playhead">
            − Key
          </button>
          <button className="btn ghost" disabled={!s.bgKeys.length} onClick={clearBgKeys} title="Remove all background keys (keeps the current look)">
            Clear
          </button>
        </div>
        {bgKeyHere && (
          <>
            <Row label="Change">
              <select value={bgKeyHere.transition} onChange={(e) => updateBgKey(bgKeyHere.id, { transition: e.target.value })}>
                <option value="fade">Crossfade</option>
                <option value="cut">Cut</option>
              </select>
            </Row>
            {bgKeyHere.transition === 'fade' && (
              <Row label="Fade time">
                <Slider value={bgKeyHere.dur} onChange={(v) => updateBgKey(bgKeyHere.id, { dur: v })} min={0.1} max={3} step={0.05} suffix="s" />
              </Row>
            )}
          </>
        )}
        {s.bgKeys.length > 0 && !bgKeyHere && (
          <div className="hint">{s.bgKeys.length} background {s.bgKeys.length === 1 ? 'key' : 'keys'} — changing the background here adds a key at the playhead</div>
        )}
      </Section>

      <MusicSection />

      <ClaudeSection />

      <Section title="Light & floor">
        <Segmented
          options={Object.entries(LIGHT_PRESETS)}
          value={s.lightPreset}
          onChange={(v) => set({ lightPreset: v })}
        />
        <Row label="Intensity">
          <Slider value={s.lightIntensity} onChange={(v) => set({ lightIntensity: v })} min={0.2} max={2.5} step={0.1} />
        </Row>
        <Row label="Shadow">
          <input type="checkbox" checked={s.shadow} onChange={(e) => set({ shadow: e.target.checked })} />
        </Row>
        <Row label="Reflection">
          <input type="checkbox" checked={s.reflection} onChange={(e) => set({ reflection: e.target.checked })} />
        </Row>
      </Section>

      <Section title="Export">
        <Segmented
          options={[
            ...Object.entries(ASPECTS).map(([k, v]) => [k, `${v.label}`]),
            ...(s.aspect === 'custom' ? [['custom', getAspect(s).label]] : []),
          ]}
          value={s.aspect}
          onChange={(v) => set({ aspect: v })}
        />
        <Row label="Size">
          <select value={s.exportRes} onChange={(e) => set({ exportRes: Number(e.target.value) })}>
            <option value={1080}>1080 px</option>
            <option value={1620}>1620 px</option>
            <option value={2160}>2160 px</option>
            <option value={3240}>3240 px</option>
          </select>
        </Row>
        {s.bgType === 'transparent' && <div className="hint">background will be transparent</div>}
        <button className="btn primary" disabled={busy} onClick={doExport} title="⌘E">
          {busy ? 'Rendering…' : 'Export PNG'}
        </button>
        {savedMsg && <div className="hint ok">{savedMsg}</div>}
      </Section>

      <VideoExport />
    </div>
    </OnlyCtx.Provider>
  )
}

function VideoExport() {
  const s = useStore()
  const set = s.set
  const keyCount = useTimeline((t) => t.keys.length)
  const [progress, setProgress] = useState(null)
  const [msg, setMsg] = useState('')
  const cancelRef = useRef(false)

  const isElectron = !!window.spinshot
  const canExport = !s.exportingVideo

  const dims = () => {
    const a = getAspect(s)
    const short = s.exportRes
    const w = a.w <= a.h ? short : Math.round((short * a.w) / a.h)
    const h = a.w <= a.h ? Math.round((short * a.h) / a.w) : short
    return { w, h }
  }

  const run = async () => {
    setMsg('')
    setProgress(0)
    cancelRef.current = false
    set({ exportingVideo: true })
    useTimeline.setState({ playing: false })
    try {
      const { w, h } = dims()
      if (s.videoFormat === 'mp4') {
        const res = await exportTimeline({
          width: w,
          height: h,
          fps: s.videoFps,
          mode: 'mp4',
          name: `spinshot-${w}x${h}.mp4`,
          onProgress: setProgress,
          shouldCancel: () => cancelRef.current,
        })
        if (res?.saved) setMsg('Video saved')
      } else {
        const dir = await window.spinshot.chooseDir()
        if (!dir) return
        await exportTimeline({
          width: w,
          height: h,
          fps: s.videoFps,
          mode: 'frames',
          onFrame: (dataURL, i) =>
            window.spinshot.saveFrame(dir, `frame-${String(i).padStart(4, '0')}.png`, dataURL),
          onProgress: setProgress,
          shouldCancel: () => cancelRef.current,
        })
        setMsg('Frames saved to folder')
      }
    } catch (err) {
      setMsg(err.message === 'cancelled' ? 'Cancelled' : 'Export failed: ' + err.message)
    } finally {
      set({ exportingVideo: false })
      setProgress(null)
    }
  }

  return (
    <Section title="Export video">
      <Row label="Format">
        <select value={s.videoFormat} onChange={(e) => set({ videoFormat: e.target.value })}>
          <option value="mp4">MP4 (H.264)</option>
          {isElectron && <option value="frames">PNG sequence</option>}
        </select>
      </Row>
      <Row label="FPS">
        <select value={s.videoFps} onChange={(e) => set({ videoFps: Number(e.target.value) })}>
          <option value={24}>24</option>
          <option value={30}>30</option>
          <option value={60}>60</option>
        </select>
      </Row>
      {keyCount < 2 && <div className="hint">tip: camera moves come from keyframes (＋ Key) or a motion preset — scenes, text and music export either way</div>}
      {s.videoFormat === 'mp4' && s.bgType === 'transparent' && (
        <div className="hint">MP4 has no transparency — use PNG sequence for that</div>
      )}
      {s.exportingVideo ? (
        <>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${Math.round((progress || 0) * 100)}%` }} />
          </div>
          <button className="btn" onClick={() => (cancelRef.current = true)}>Cancel</button>
        </>
      ) : (
        <button className="btn primary" disabled={!canExport} onClick={run}>
          Export video
        </button>
      )}
      {msg && <div className="hint ok">{msg}</div>}
    </Section>
  )
}
