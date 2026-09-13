import React, { useRef } from 'react'
import { useStore } from '../store.js'
import { setMusicFile, removeMusic } from '../lib/timeline.js'
import { setScreenFile } from '../App.jsx'
import { fmtTime } from '../lib/format.js'

// The project's assets — recordings, screenshot, music, fonts — like AE's Project panel.
export default function ProjectPanel() {
  const s = useStore()
  const set = s.set
  const input = useRef(null)
  const items = []
  if (s.screenType === 'video') {
    for (const m of s.media) items.push({ icon: '▶', kind: 'Recording', name: m.name, meta: m.dur ? fmtTime(m.dur, 1) : '…' })
  } else if (s.screenSrc) {
    items.push({ icon: '▣', kind: 'Screenshot', name: 'Screen image', meta: '' })
  }
  if (s.music) items.push({ icon: '♫', kind: 'Music', name: s.music.name, meta: fmtTime(s.music.dur, 1), remove: removeMusic })
  for (const f of s.fonts || []) items.push({ icon: 'Aa', kind: 'Font', name: f.name, meta: f.ext })

  return (
    <div className="project-panel">
      <div className="project-head">
        <span className="project-title">{s.projectName}</span>
        <button className="btn ghost" onClick={() => input.current.click()} title="Import a screen recording, screenshot or audio file">
          ＋ Import
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*,video/*,audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files[0]
            if (f) {
              if (f.type.startsWith('audio/')) setMusicFile(f).catch((err) => alert(err.message))
              else setScreenFile(f, set)
            }
            e.target.value = ''
          }}
        />
      </div>
      {items.length === 0 ? (
        <div className="dock-empty">
          <div>No assets yet</div>
          <div className="hint">Drop a screen recording, screenshot or music file anywhere in the window.</div>
        </div>
      ) : (
        <div className="asset-list">
          {items.map((it, i) => (
            <div key={i} className="asset">
              <span className="asset-icon">{it.icon}</span>
              <span className="asset-name" title={it.name}>{it.name}</span>
              <span className="asset-meta">{it.kind}{it.meta ? ` · ${it.meta}` : ''}</span>
              {it.remove && (
                <button className="chip-x" onClick={it.remove} title="Remove">×</button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="hint project-hint">Recordings are cut and arranged on the Timeline's video lane; drop another one to append it.</div>
    </div>
  )
}
