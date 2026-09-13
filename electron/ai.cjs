// AI integration, main-process side: API keys live here (encrypted with macOS
// safeStorage), the renderer only ever sees results. Two providers:
//  - anthropic:  the official SDK, structured outputs via zodOutputFormat
//  - openrouter: OpenAI-compatible chat completions, any model id, JSON schema output
const { app, ipcMain, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')
const Anthropic = require('@anthropic-ai/sdk')
const { z } = require('zod')
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod')

const DEFAULT_MODEL = 'claude-opus-5'
const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 (recommended)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (faster, cheaper)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (cheapest)' },
]
// $ per million tokens, for the pre-flight estimate shown in the app
const PRICES = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
}
const OPENROUTER = 'https://openrouter.ai/api/v1'
const OR_SUGGESTIONS = [
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-opus-4.6',
  'openai/gpt-5',
  'openai/gpt-5-mini',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'x-ai/grok-4',
  'deepseek/deepseek-chat-v3.1',
  'meta-llama/llama-4-maverick',
]

const keyFile = (provider) => path.join(app.getPath('userData'), provider === 'openrouter' ? 'ai-key-openrouter.bin' : 'ai-key.bin')
const settingsFile = () => path.join(app.getPath('userData'), 'ai-settings.json')

function readKey(provider) {
  try {
    const enc = fs.readFileSync(keyFile(provider))
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(enc) : enc.toString('utf8')
  } catch {
    return null
  }
}
function writeKey(provider, key) {
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8')
  fs.writeFileSync(keyFile(provider), data, { mode: 0o600 })
}
const DEFAULT_SETTINGS = { provider: 'anthropic', model: DEFAULT_MODEL, orModel: '' }
function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
function writeSettings(s) {
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2))
}
const provider = () => readSettings().provider || 'anthropic'
const modelId = () => {
  const s = readSettings()
  return s.provider === 'openrouter' ? (s.orModel || '').trim() : s.model || DEFAULT_MODEL
}

function client() {
  const key = readKey('anthropic')
  if (!key) throw new Error('No Anthropic API key — add one in Settings')
  return new Anthropic({ apiKey: key })
}

function errorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'API key was rejected — check it in Settings'
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the API — try again in a moment'
  if (err instanceof Anthropic.APIError) return `API error ${err.status}: ${err.message}`
  return err?.message || String(err)
}

// ---- OpenRouter ----
let orModelCache = { at: 0, list: null }
async function orModels() {
  if (orModelCache.list && Date.now() - orModelCache.at < 10 * 60 * 1000) return orModelCache.list
  const res = await fetch(`${OPENROUTER}/models`)
  if (!res.ok) throw new Error(`OpenRouter models list failed (${res.status})`)
  const data = await res.json()
  orModelCache = { at: Date.now(), list: data.data || [] }
  return orModelCache.list
}
async function orModelInfo(id) {
  try {
    return (await orModels()).find((m) => m.id === id) || null
  } catch {
    return null
  }
}
function orHeaders() {
  const key = readKey('openrouter')
  if (!key) throw new Error('No OpenRouter API key — add one in Settings')
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/themtaysw/spinshot',
    'X-Title': 'Spinshot',
  }
}
const stripFences = (s) =>
  String(s || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

async function orChat({ schema, system, content, maxTokens, withFormat = true }) {
  const model = modelId()
  if (!model) throw new Error('No OpenRouter model set — enter one in Settings (e.g. anthropic/claude-sonnet-4.5)')
  const jsonSchema = z.toJSONSchema(schema)
  delete jsonSchema.$schema
  const parts = content.map((c) =>
    c.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` } }
      : { type: 'text', text: c.text }
  )
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'system',
        content: withFormat ? system : `${system}\n\nRespond with a single JSON object only (no prose, no code fences) matching this JSON schema:\n${JSON.stringify(jsonSchema)}`,
      },
      { role: 'user', content: parts },
    ],
    ...(withFormat ? { response_format: { type: 'json_schema', json_schema: { name: 'result', strict: false, schema: jsonSchema } } } : {}),
  }
  const res = await fetch(`${OPENROUTER}/chat/completions`, { method: 'POST', headers: orHeaders(), body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    const msg = data?.error?.message || `OpenRouter error ${res.status}`
    // some models reject structured output — fall back to prompting for JSON
    if (withFormat && res.status === 400 && /response_format|json_schema|structured/i.test(msg)) {
      return orChat({ schema, system, content, maxTokens, withFormat: false })
    }
    if (res.status === 401) throw new Error('OpenRouter API key was rejected — check it in Settings')
    if (res.status === 404) throw new Error(`Model "${model}" not found on OpenRouter — check the id in Settings`)
    throw new Error(msg)
  }
  const choice = data.choices?.[0]
  const text = stripFences(choice?.message?.content)
  if (!text) throw new Error('The model returned no content')
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('The model did not return JSON')
    obj = JSON.parse(m[0])
  }
  return {
    parsed: schema.parse(obj),
    usage: { input_tokens: data.usage?.prompt_tokens, output_tokens: data.usage?.completion_tokens },
  }
}

// One structured request, whichever provider is active.
// content: Anthropic-style blocks [{type:'text',text}|{type:'image',source:{...}}]
async function structured({ schema, system, content, maxTokens, effort = 'low', stream = false }) {
  if (provider() === 'openrouter') return orChat({ schema, system, content, maxTokens })
  const c = client()
  const req = {
    model: modelId(),
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: zodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content }],
  }
  if (stream) {
    const res = await c.messages.stream(req).finalMessage()
    if (res.stop_reason === 'refusal') throw new Error('The model declined this request')
    const textBlock = res.content.find((b) => b.type === 'text')
    if (!textBlock) throw new Error('No result came back')
    return { parsed: schema.parse(JSON.parse(textBlock.text)), usage: res.usage }
  }
  const res = await c.messages.parse(req)
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request')
  if (!res.parsed_output) throw new Error('The result could not be parsed')
  return { parsed: res.parsed_output, usage: res.usage }
}

// ---- schemas ----
const TranslationSchema = z.object({
  languages: z.array(
    z.object({
      code: z.string(),
      items: z.array(z.object({ id: z.string(), text: z.string() })),
    })
  ),
})

const CopySchema = z.object({ variants: z.array(z.string()) })

const StoryboardSchema = z.object({
  title: z.string(),
  scenes: z.array(
    z.object({
      kind: z.enum(['text', 'phone']),
      duration: z.number(),
      headline: z.string(),
      subline: z.string(),
      reveal: z.enum(['fade-up', 'blur', 'words', 'chars', 'tracking', 'scale', 'wipe']),
      mediaId: z.string().nullable(),
      srcStart: z.number().nullable(),
      srcEnd: z.number().nullable(),
      bgColor1: z.string(),
      bgColor2: z.string(),
      badge: z.string().nullable(),
    })
  ),
})

const SPINSHOT_SYSTEM = `You write copy and plans for short mobile-app presentation videos and ads made in Spinshot,
a tool that shows an iPhone with a screen recording on a stage, with animated title text, badges and background colors.
Write like Apple keynote copy: short, concrete, benefit-led, no exclamation marks, no emoji, no hype words.`

function translatePrompt({ items, languages, context }) {
  return `Translate the following on-screen text layers of an app video into these languages: ${languages
    .map((l) => `${l.name} (${l.code})`)
    .join(', ')}.
Keep the meaning, tone and approximate length (these sit on a phone-sized stage — prefer short renderings). Keep product names, app names and proper nouns untranslated. Keep line breaks (\\n) where the source has them. Return every item id for every language, using exactly the language codes given.
${context ? `App context: ${context}\n` : ''}
Items:
${items.map((it) => `[${it.id}] ${JSON.stringify(it.text)}`).join('\n')}`
}

function storyboardPrompt({ brief, seconds, media, hasVideo, context, sequence }) {
  const seq = sequence || { aspect: '9:16', orientation: 'portrait', fps: 30 }
  const limits =
    seq.orientation === 'portrait'
      ? 'The frame is a narrow portrait phone screen: headline ≤ 4 words or ≤ 20 characters per line — break longer headlines into two lines with \\n; subline ≤ 8 words.'
      : seq.orientation === 'square'
      ? 'The frame is square: headline ≤ 5 words (≤ 26 characters per line, use \\n for two lines); subline ≤ 10 words.'
      : 'The frame is landscape: headline ≤ 6 words; subline ≤ 12 words.'
  return `Plan a ${seconds}-second app video.

Sequence settings: ${seq.aspect} ${seq.orientation}, ${seq.fps} fps, ${seconds}s. ${limits}

Brief from the maker:
${brief}
${context ? `\nApp context: ${context}\n` : ''}

${
  hasVideo
    ? `Available screen recordings (use their ids; times in seconds):
${media.map((m) => `- id "${m.id}" "${m.name}", ${m.dur.toFixed(1)}s long. Sampled frames follow, evenly spaced from 0s to ${m.dur.toFixed(1)}s.`).join('\n')}`
    : 'There are no screen recordings — make every scene a text scene.'
}

Rules:
- 3 to 7 scenes; durations sum to about ${seconds}s; each scene 2–5s.
- "phone" scenes show the iPhone playing a recording: set mediaId, srcStart, srcEnd (srcEnd - srcStart must equal the scene duration and lie within that recording). Pick moments that show something happening. Use each recording's most interesting parts; don't reuse the same seconds twice.
- "text" scenes show only text on the stage: mediaId/srcStart/srcEnd null. Open with a text scene that hooks, end with a text scene that calls to action or names the app.
- Respect the headline/subline limits above (subline may be empty). Reveal: "blur" for hooks and endings, "words" for benefit lines, "fade-up" otherwise.
- Backgrounds: two hex colors per scene (top, bottom). Keep a coherent palette across scenes: text scenes may use a bold color; phone scenes should be calm (near-white or near-black) so the phone reads well.
- badge: a 1–2 word pill label (e.g. "NEW", "FREE") or null. Use sparingly.`
}

const keysStatus = () => {
  const p = provider()
  const anthropic = !!readKey('anthropic')
  const openrouter = !!readKey('openrouter')
  return { anthropic, openrouter, active: p === 'openrouter' ? openrouter && !!modelId() : anthropic, provider: p }
}

function register() {
  ipcMain.handle('ai-key-has', () => keysStatus())
  ipcMain.handle('ai-key-set', (_e, { key, provider: p }) => {
    writeKey(p || provider(), String(key).trim())
    return keysStatus()
  })
  ipcMain.handle('ai-key-clear', (_e, { provider: p } = {}) => {
    try {
      fs.unlinkSync(keyFile(p || provider()))
    } catch {
      /* none */
    }
    return keysStatus()
  })
  ipcMain.handle('ai-settings-get', () => ({ ...readSettings(), models: MODELS, orSuggestions: OR_SUGGESTIONS }))
  ipcMain.handle('ai-settings-set', (_e, patch) => {
    writeSettings({ ...readSettings(), ...patch })
    return readSettings()
  })

  ipcMain.handle('ai-test', async () => {
    try {
      if (provider() === 'openrouter') {
        const id = modelId()
        if (!id) return { ok: false, error: 'Enter a model id first (e.g. anthropic/claude-sonnet-4.5)' }
        const res = await fetch(`${OPENROUTER}/key`, { headers: orHeaders() })
        if (res.status === 401) return { ok: false, error: 'OpenRouter API key was rejected' }
        if (!res.ok) return { ok: false, error: `OpenRouter responded ${res.status}` }
        const info = await orModelInfo(id)
        if (!info) return { ok: false, error: `Key works, but "${id}" is not in OpenRouter's model list — check the id at openrouter.ai/models` }
        const pIn = Number(info.pricing?.prompt || 0) * 1e6
        const pOut = Number(info.pricing?.completion || 0) * 1e6
        const vision = (info.architecture?.input_modalities || []).includes('image')
        return {
          ok: true,
          model: `${info.name || id} · $${pIn.toFixed(2)} / $${pOut.toFixed(2)} per M tokens${vision ? '' : ' · no image input (storyboard frames will be skipped)'}`,
        }
      }
      const m = await client().models.retrieve(modelId())
      return { ok: true, model: m.display_name || m.id }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  // rough pre-flight cost, from a token count of the real request text
  ipcMain.handle('ai-estimate', async (_e, { kind, payload }) => {
    try {
      let user = ''
      let expectedOut = 0
      let images = 0
      if (kind === 'translate') {
        user = translatePrompt(payload)
        expectedOut = payload.items.reduce((a, it) => a + it.text.length / 3, 0) * payload.languages.length + 50 * payload.languages.length
      } else if (kind === 'storyboard') {
        user = `${payload.brief}\n${payload.seconds}`
        images = payload.frameCount || 0
        expectedOut = 2500
      }
      const imageTokens = images * 420 // ~320×700 JPEGs
      if (provider() === 'openrouter') {
        const id = modelId()
        const info = await orModelInfo(id)
        const textTokens = Math.ceil((SPINSHOT_SYSTEM.length + user.length) / 4)
        const inputTokens = textTokens + imageTokens
        let usd = null
        if (info?.pricing) {
          usd = inputTokens * Number(info.pricing.prompt || 0) + expectedOut * Number(info.pricing.completion || 0)
          if (info.pricing.image) usd += images * Number(info.pricing.image)
        }
        return { ok: true, inputTokens, usd, model: id || '(no model set)' }
      }
      const c = client()
      const m = modelId()
      const p = PRICES[m] || PRICES[DEFAULT_MODEL]
      const count = await c.messages.countTokens({ model: m, system: SPINSHOT_SYSTEM, messages: [{ role: 'user', content: user || '-' }] })
      const inputTokens = count.input_tokens + imageTokens
      const usd = (inputTokens * p.in + expectedOut * p.out) / 1e6
      return { ok: true, inputTokens, usd, model: m }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle('ai-translate', async (_e, payload) => {
    try {
      const { parsed, usage } = await structured({
        schema: TranslationSchema,
        system: SPINSHOT_SYSTEM,
        content: [{ type: 'text', text: translatePrompt(payload) }],
        maxTokens: 16000,
        effort: 'low',
      })
      const out = {}
      for (const lang of parsed.languages || []) out[lang.code] = Object.fromEntries(lang.items.map((it) => [it.id, it.text]))
      return { ok: true, translations: out, usage }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle('ai-copy', async (_e, { text, mode, context }) => {
    try {
      const modes = {
        punchier: 'Rewrite it to be punchier and more confident.',
        shorter: 'Make it shorter — ideally under 5 words per line.',
        formal: 'Make it more polished and formal.',
        playful: 'Make it warmer and a little playful, still tasteful.',
        alternatives: 'Give 5 distinct alternatives with different angles (benefit, feeling, feature, question, contrast).',
      }
      const { parsed, usage } = await structured({
        schema: CopySchema,
        system: SPINSHOT_SYSTEM,
        content: [
          {
            type: 'text',
            text: `${context ? `App context: ${context}\n` : ''}This is a text layer in the video:\n${JSON.stringify(text)}\n\n${modes[mode] || modes.alternatives} Keep line breaks (\\n) if the source has them. Return 3–5 variants.`,
          },
        ],
        maxTokens: 4000,
        effort: 'low',
      })
      return { ok: true, variants: parsed.variants || [], usage }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })

  ipcMain.handle('ai-storyboard', async (_e, { brief, seconds, media, hasVideo, context, sequence }) => {
    try {
      let mediaList = media
      if (provider() === 'openrouter') {
        const info = await orModelInfo(modelId())
        const vision = !info || (info.architecture?.input_modalities || []).includes('image')
        if (!vision) mediaList = media.map((m) => ({ ...m, frames: [] }))
      }
      const content = [{ type: 'text', text: storyboardPrompt({ brief, seconds, media: mediaList, hasVideo, context, sequence }) }]
      for (const m of mediaList) {
        for (const f of m.frames || []) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f } })
      }
      const { parsed, usage } = await structured({
        schema: StoryboardSchema,
        system: SPINSHOT_SYSTEM,
        content,
        maxTokens: 16000,
        effort: 'high',
        stream: true,
      })
      return { ok: true, plan: parsed, usage }
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  })
}

module.exports = { register }
