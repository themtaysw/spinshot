# Spinshot

Personal 3D device-mockup studio (a Rotato-style app for your own use). Drop a screenshot onto a 3D iPhone, style the scene, export a high-res PNG. 100% offline, no accounts.

## Run it

**Normal use:** open **Spinshot** from your Applications folder (or Spotlight) — it's a fully installed app.

Development (hot reload):

```bash
npm run dev
```

Rebuild + reinstall the app after code changes:

```bash
npm run package
```

then copy `release/mac-arm64/Spinshot.app` over `/Applications/Spinshot.app`.

## How to use

- **Screen** — drag & drop any screenshot anywhere in the window (or “Choose image…”). Portrait screenshots look best; the image is cover-cropped to the display.
- **Orbit** — drag in the viewport to rotate the camera, scroll to zoom. The Device sliders rotate the phone itself instead — combining both gives you any angle.
- **Lens** — low FOV = flat product shot, high FOV = dramatic wide-angle.
- **Background** — None gives a transparent PNG (for landing pages), or pick solid / gradient / your own image.
- **Export** — pick an aspect (Square / Portrait / Story / Wide) and a size; the size number is the short side in pixels. Export renders offscreen at full resolution, so the PNG is always crisp regardless of window size.
- **Save project / Open project** — a `.spinshot` file bundles everything: scene, animation, the screenshot **and** the screen video. Double-clicking a `.spinshot` file in Finder opens it in Spinshot. (Old `.json` scene files still open too.)
- **Multiple recordings** — drop a second (third, …) screen recording and it's appended to the video lane as a new clip; each clip shows its recording's name. Cut, trim and speed them like any clip; exports and project bakes stitch them into one video.
- **Reorder clips** — drag a clip left or right along the lane; an orange line shows where it will land. Keyframes and text layers travel with their footage.
- **Drag keyframes** — camera keyframes (diamonds on the CAMERA lane) and text position keys can be dragged in time; a plain click jumps the playhead to them.
- **Video lane (clip editor)** — with a recording loaded, a second lane appears under the camera lane showing the recording as a clip with a filmstrip. **S** (or ✂ Split) cuts it at the playhead; drag a clip's edges to trim; click a clip and pick a **speed** (0.5×–4×); **⌫** removes the selected clip. The timeline's length *is* the edited program's length — no limit on how long the recording is.
- **Ripple** — edits on the video lane move the camera keyframes with them: delete a clip and later keyframes shift left (keyframes inside it are removed); speed a clip up and the keyframes inside it compress to match. Your camera moves stay aimed at the same moments in the footage.
- **Zoom** — the slider at the right of the toolbar, or **⌘ + scroll** over the timeline (zooms around the cursor). Double-click the slider to fit.
- **Bake on save** (checkbox in the Screen section, on by default) — projects save only the *edited* video, re-encoded to H.264, so a long capture doesn't bloat the `.spinshot` file. Untick to keep the full original recording (lets you re-edit it differently later).
- Long exports stream straight to disk chunk by chunk, so a multi-minute 4K export never has to fit in memory.

## Scenes

The **＋ Scene…** menu in the timeline toolbar builds ad-style structure:
- **Text scene** — hides the phone for 4s at the playhead, keys the background, and drops in a title + subtitle pair.
- **Phone scene** — the phone rises onto the stage for 4s (intro/outro animations are editable in the Device scene section: cut, fade, rise, drop, slide, scale).
- **Hide phone for 4s here** / **Phone always on stage** — direct control of the DEVICE lane. Segments drag and trim like clips.
- **Background key here** — the BACKGROUND lane holds keyed backgrounds; each key crossfades (or cuts) from the previous one. With keys present, editing the Background section edits the key at the playhead.

Everything ripples with video edits and is covered by undo. Exports render scenes exactly as previewed.

## Music

Drop an audio file (mp3, m4a, wav…) anywhere, or use the Music section's **Import music…**. It appears on a MUSIC lane with its waveform: drag the block to set where it starts, drag its edges to trim which part plays. Volume, fade in and fade out live in the Music section. Playback is sample-locked to the timeline — press play from anywhere and you hear the right spot — and the track is rendered into MP4 exports (AAC, or Opus if the machine lacks an AAC encoder). PNG-sequence exports have no audio, naturally. The audio file is embedded in the project.

## Claude

Open **Settings** (⚙ in the top bar) and paste your Anthropic API key — it's stored encrypted in the macOS keychain and only ever used from this Mac to call the API. Pick a model (Opus 5 default). Every action shows a cost estimate and asks before running; it's billed to your key.

The **Claude** section in the inspector:
- **Localize** — pick languages and translate every text layer in one go. Translations become switchable variants (**Show: Original / German / …**); the viewport, exports and the Text section follow the selected language, and edits apply to that language only. **Export all languages…** renders one MP4 per language into a folder you choose. Translations are saved in the project.
- **AI storyboard** — describe the app and the goal, pick a length, and Claude drafts scenes (text-only and phone), cut points into your recordings (it sees sampled frames), titles, sublines, reveals, badges and background palettes — applied as a real editable timeline. ⌘Z restores what you had.
- In the **Text** section: **✦ Punchier / Shorter / Ideas** ask Claude for rewrites of the selected text; pick one with **Use**.

## Text layers

Press **T** (or ＋ Text) to add a text layer at the playhead. It appears on a TEXT lane: drag the block to move it in time, drag its edges to set how long it stays, click it to edit. **Drag the text itself in the viewport** to position it. The Text section in the inspector has Title / Subtitle / Caption styles, font (SF Pro and other system fonts), weight, size (relative to frame height, so exports match at any resolution), tracking, leading, color, alignment, and the reveal:

- **Fade up**, **Blur in**, **Word by word**, **Letter by letter** (with stagger), **Tracking in**, **Scale in**, **Wipe up** — each with duration and easing; exit as fade, reverse of the reveal, or a cut.

Text is drawn with the same renderer in the viewport and in every exported PNG/video frame, so what you see is exactly what exports. Video edits ripple text blocks along with keyframes. Text renders in front of the phone.

Presentation kit:
- **＋ Pair** adds the classic keynote combo: a blur-in title with a fade-up subtitle 0.3s behind it, positioned together.
- **Gradient fills** (two colors + angle) and a **shadow** slider.
- **Save style…** stores a text's whole look (font, size, colors, reveal…) as a reusable chip next to Title / Subtitle / Caption; hover a chip to remove it. Saved styles are yours across all projects.
- **Import font…** loads a `.ttf` / `.otf` / `.woff2` brand font; it's embedded in the `.spinshot` project so it opens correctly anywhere.
- **⌘D** duplicates the selected text (placed just below the original).

**Align** — in the Text section, the Align row snaps the selected text or callout to the frame's left / center / right and top / middle / bottom (measured on the rendered bounds, with a 6% margin); **Fit** shrinks the size until it fits the frame width. The Device section has **Center phone**. The storyboard and ＋ Pair auto-fit their text to the sequence's format, and the AI is told the format, orientation, fps and length so it writes headlines that fit.

**Position keyframes** — in the Text section, **◇ Key position** keyframes the text's x/y/size at the playhead. Move the playhead, drag the text (or change X/Y/Size) and it becomes a second key; the text eases between keys while it's on screen. Keys show as small diamonds on the text's block (click one to jump to it). Once a text is keyed, moving it always edits the key at the playhead; **− Key** / **Clear** remove keys.

**Easing graph** — with two or more position keys, the Text section shows an After-Effects-style curve editor for the move the playhead is in: drag the two handles (overshoot allowed) or pick a preset — Linear, Ease, Ease in, Ease out, In-out, Snappy (fast start, soft landing — the Apple feel), Overshoot. Each move between keys can have its own curve. The same editor in the Camera section sets the easing for camera / rotation / phone-position keyframes (the toolbar's Ease / Linear menu shows "Curve" when a custom one is set).

**Phone position** — Device section → Move X / Y / Z, or hold **⌥ and drag the phone** in the viewport. Position is part of the camera keyframes, so it animates just like rotation (and auto-key records it).

Callouts (Text section → Callout): give any text a **Pill** or **Card** background, turn it into a **Dot marker** (leave the text empty for a plain tap indicator), or an **Arrow callout** — a labelled box with an arrow that draws on toward a target you drag in the viewport. Shape color, opacity and padding are adjustable, and shapes share the text's reveal/exit. **＋ Badge** in the toolbar adds a ready-made "NEW" pill.

## Undo / redo

**⌘Z** / **⇧⌘Z** (or the arrows in the top bar) step through every edit — scene settings, keyframes, clip edits, text layers. Slider drags and typing bursts count as one step; playback and scrubbing are never recorded.

## Workspace

Spinshot uses an After Effects-style dockable workspace. Every surface is a tab — Project, Composition, Timeline, Properties (the selected text / phone segment), AI assistant, Device, Camera, Background, Light & floor, Screen, Music, Export image, Export video. Drag a tab by its header to dock it anywhere (an overlay shows where it lands), drop it onto another tab strip to group them, drag the dividers to resize, double-click a tab strip to maximize. Closed panels come back from the **Window** menu in the top bar, which also has **Reset workspace**. The layout is remembered between launches.

Property values are After Effects-style: **drag the number** to scrub (⇧ coarse, ⌥ fine), **double-click** to type, or click/drag the hairline track.

## Keyboard shortcuts

- **⌘S** save project · **⌘O** open project · **⌘E** export PNG · **⌘Z / ⇧⌘Z** undo / redo · **⌘D** duplicate text
- **Space** play/pause · **K** add keyframe · **T** add text · **S** split video at playhead · **⌫** delete selected text / clip (or the keyframe at the playhead) · **Esc** deselect
- **← / →** step 0.1s (with **Shift**: 1s)

## Animation & video

- **Timeline** (bottom bar) — press **＋ Key** once to start an animation, then just scrub anywhere and move the camera or device: with **auto-key** on (the red dot), keyframes record themselves Rotato-style. Space or ▶ plays. Scrub by dragging the track.
- **Loop** — when looping, the animation smoothly eases back to its start pose instead of jumping, and looping video exports include that return so the file loops seamlessly. Rotations take the shortest path, so a 360° spin stays seamless too.
- **Presets…** — Hero spin / Orbit / Dolly in / Sway generate a full animation from your current framing in one click (they replace existing keyframes).
- **Ease / Linear** — easing between keyframes. **Length** — total duration in seconds.
- **Video on the screen** — drop a screen recording (`.mp4`/`.mov`/`.webm`) instead of an image. The video is locked to the timeline: dropping it fits the timeline to the video's duration, scrubbing shows that exact frame, ▶ plays them together, and exports are frame-synced — so you can animate the phone precisely against moments in your recording.
- **Export video** (right panel) — MP4 (H.264, hardware-encoded) at 24/30/60 fps, or a transparent **PNG sequence** (desktop app only) for compositing. Export renders the timeline frame-by-frame offscreen, so output is perfectly smooth regardless of live performance.

## Start screen

Spinshot opens on a **New sequence** screen: name, format (Square / Portrait / Story / Wide or a custom width:height), length, frame rate and a starting background — then **Create**. Or **Open project…** to continue one. The **+** in the top bar (⌘N) returns to it.

## AI providers

Settings (⚙) lets you pick **Anthropic** (official API, pick a Claude model) or **OpenRouter** (paste an OpenRouter key and any model id from openrouter.ai/models, e.g. `openai/gpt-5` or `google/gemini-2.5-pro`). Keys are stored encrypted in the macOS keychain. **Test connection** validates the key and, for OpenRouter, the model id and shows its per-token price; cost estimates before each action use that price. Models without image input still work for translation and copy — the storyboard just runs without frames.
