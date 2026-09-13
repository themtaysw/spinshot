import React, { useEffect, useState } from 'react'
import { useStore } from '../store.js'
import { aiApi } from '../lib/ai.js'

export default function SettingsDialog() {
  const open = useStore((s) => s.showSettings)
  const close = () => useStore.setState({ showSettings: false })
  const api = aiApi()
  const [keys, setKeys] = useState({ anthropic: false, openrouter: false, active: false })
  const [provider, setProvider] = useState('anthropic')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('claude-opus-5')
  const [orModel, setOrModel] = useState('')
  const [models, setModels] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!open || !api) return
    api.hasKey().then(setKeys)
    api.getSettings().then((s) => {
      setProvider(s.provider || 'anthropic')
      setModel(s.model)
      setOrModel(s.orModel || '')
      setModels(s.models || [])
      setSuggestions(s.orSuggestions || [])
    })
    setStatus('')
    setKey('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const hasKey = provider === 'openrouter' ? keys.openrouter : keys.anthropic

  const saveKey = async () => {
    if (!key.trim()) return
    setKeys(await api.setKey(key.trim(), provider))
    setKey('')
    setStatus('Key saved to the macOS keychain')
  }
  const clearKey = async () => {
    setKeys(await api.clearKey(provider))
    setStatus('Key removed')
  }
  const test = async () => {
    setStatus('Testing…')
    const r = await api.test()
    setStatus(r.ok ? `Connected · ${r.model}` : r.error)
  }
  const changeProvider = async (p) => {
    setProvider(p)
    setStatus('')
    setKeys(await api.setSettings({ provider: p }).then(() => api.hasKey()))
  }
  const changeModel = async (m) => {
    setModel(m)
    await api.setSettings({ model: m })
  }
  const changeOrModel = async (m) => {
    setOrModel(m)
    await api.setSettings({ orModel: m.trim() })
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <div className="modal-title">
          Settings
          <button className="btn ghost" onClick={close} title="Close (Esc)">✕</button>
        </div>
        {!api ? (
          <div className="hint">AI features are available in the desktop app.</div>
        ) : (
          <>
            <div className="sub-label">AI provider</div>
            <div className="segmented">
              <button className={provider === 'anthropic' ? 'active' : ''} onClick={() => changeProvider('anthropic')}>Anthropic</button>
              <button className={provider === 'openrouter' ? 'active' : ''} onClick={() => changeProvider('openrouter')}>OpenRouter</button>
            </div>

            <div className="sub-label">{provider === 'openrouter' ? 'OpenRouter API key' : 'Anthropic API key'}</div>
            <div className="hint">
              {hasKey
                ? 'A key is stored, encrypted in your macOS keychain. Paste a new one to replace it.'
                : provider === 'openrouter'
                ? 'Get a key at openrouter.ai → Keys. Stored encrypted on this Mac; only used to call OpenRouter.'
                : 'Get a key at console.anthropic.com → API keys. Stored encrypted on this Mac; only used to call the API.'}
            </div>
            <div className="btn-row tight">
              <input
                className="text-field"
                type="password"
                placeholder={provider === 'openrouter' ? 'sk-or-…' : 'sk-ant-…'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                spellCheck={false}
              />
              <button className="btn primary" disabled={!key.trim()} onClick={saveKey}>Save</button>
              {hasKey && <button className="btn ghost danger" onClick={clearKey}>Remove</button>}
            </div>

            <div className="sub-label">Model</div>
            {provider === 'openrouter' ? (
              <>
                <input
                  className="text-field"
                  list="or-models"
                  placeholder="vendor/model-id, e.g. anthropic/claude-sonnet-4.5"
                  value={orModel}
                  onChange={(e) => changeOrModel(e.target.value)}
                  spellCheck={false}
                  style={{ width: '100%' }}
                />
                <datalist id="or-models">
                  {suggestions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <div className="hint">
                  Any id from openrouter.ai/models. Test connection checks the id and shows its price. Models without image input still work — the storyboard just won't see frames.
                </div>
              </>
            ) : (
              <>
                <select value={model} onChange={(e) => changeModel(e.target.value)}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <div className="hint">Opus 5 gives the best copy and storyboards; Sonnet 5 is about 2.5× cheaper for translations.</div>
              </>
            )}

            <div className="btn-row tight">
              <button className="btn" disabled={!hasKey} onClick={test}>Test connection</button>
            </div>
            {status && <div className={`hint ${status.startsWith('Connected') || status.includes('saved') ? 'ok' : ''}`}>{status}</div>}
            <div className="hint">Every AI action shows a cost estimate before it runs and is billed to your key.</div>
          </>
        )}
      </div>
    </div>
  )
}
