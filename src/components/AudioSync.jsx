import { useEffect } from 'react'
import { useStore } from '../store.js'
import { useTimeline } from '../lib/timeline.js'
import { MusicPlayer } from '../lib/audio.js'

// Keeps music playback locked to the timeline: starts on play at the playhead,
// stops on pause, restarts on a loop wrap or when the track's settings change.
export default function AudioSync() {
  useEffect(() => {
    const player = new MusicPlayer()
    let lastT = useTimeline.getState().t
    const unsubTl = useTimeline.subscribe((st, prev) => {
      const s = useStore.getState()
      if (s.exportingVideo) return
      if (st.playing && !prev.playing) player.start(st.t, s.music)
      else if (!st.playing && prev.playing) player.stop()
      else if (st.playing && st.t < lastT - 0.3) player.start(st.t, s.music)
      lastT = st.t
    })
    const unsubStore = useStore.subscribe((s, prev) => {
      if (s.music === prev.music && s.exportingVideo === prev.exportingVideo) return
      const tl = useTimeline.getState()
      if (tl.playing && !s.exportingVideo) player.start(tl.t, s.music)
      else player.stop()
    })
    return () => {
      unsubTl()
      unsubStore()
      player.stop()
    }
  }, [])
  return null
}
