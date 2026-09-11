// "1:03.20" style timecode (minutes:seconds.hundredths)
export function fmtTime(t, decimals = 2) {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  const body = decimals > 0 ? sec.toFixed(decimals).padStart(3 + decimals, '0') : String(Math.floor(sec)).padStart(2, '0')
  return `${m}:${body}`
}

// ruler label: whole seconds as m:ss, sub-second steps with one decimal
export function fmtTick(t, step) {
  return step >= 1 ? fmtTime(t, 0) : fmtTime(t, 1)
}
