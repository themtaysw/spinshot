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
- **Video lane (clip editor)** — with a recording loaded, a second lane appears under the camera lane showing the recording as a clip with a filmstrip. **S** (or ✂ Split) cuts it at the playhead; drag a clip's edges to trim; click a clip and pick a **speed** (0.5×–4×); **⌫** removes the selected clip. The timeline's length *is* the edited program's length — no limit on how long the recording is.
- **Ripple** — edits on the video lane move the camera keyframes with them: delete a clip and later keyframes shift left (keyframes inside it are removed); speed a clip up and the keyframes inside it compress to match. Your camera moves stay aimed at the same moments in the footage.
- **Zoom** — the slider at the right of the toolbar, or **⌘ + scroll** over the timeline (zooms around the cursor). Double-click the slider to fit.
- **Bake on save** (checkbox in the Screen section, on by default) — projects save only the *edited* video, re-encoded to H.264, so a long capture doesn't bloat the `.spinshot` file. Untick to keep the full original recording (lets you re-edit it differently later).
- Long exports stream straight to disk chunk by chunk, so a multi-minute 4K export never has to fit in memory.

## Layout

Drag the divider above the timeline to change its height (the video lane and its thumbnails grow with it), and the divider left of the sidebar to change its width. Double-click a divider to reset. Sizes are remembered between launches.

## Keyboard shortcuts

- **⌘S** save project · **⌘O** open project · **⌘E** export PNG
- **Space** play/pause · **K** add keyframe · **S** split video at playhead · **⌫** delete selected clip (or the keyframe at the playhead) · **Esc** deselect
- **← / →** step 0.1s (with **Shift**: 1s)

## Animation & video

- **Timeline** (bottom bar) — press **＋ Key** once to start an animation, then just scrub anywhere and move the camera or device: with **auto-key** on (the red dot), keyframes record themselves Rotato-style. Space or ▶ plays. Scrub by dragging the track.
- **Loop** — when looping, the animation smoothly eases back to its start pose instead of jumping, and looping video exports include that return so the file loops seamlessly. Rotations take the shortest path, so a 360° spin stays seamless too.
- **Presets…** — Hero spin / Orbit / Dolly in / Sway generate a full animation from your current framing in one click (they replace existing keyframes).
- **Ease / Linear** — easing between keyframes. **Length** — total duration in seconds.
- **Video on the screen** — drop a screen recording (`.mp4`/`.mov`/`.webm`) instead of an image. The video is locked to the timeline: dropping it fits the timeline to the video's duration, scrubbing shows that exact frame, ▶ plays them together, and exports are frame-synced — so you can animate the phone precisely against moments in your recording.
- **Export video** (right panel) — MP4 (H.264, hardware-encoded) at 24/30/60 fps, or a transparent **PNG sequence** (desktop app only) for compositing. Export renders the timeline frame-by-frame offscreen, so output is perfectly smooth regardless of live performance.
