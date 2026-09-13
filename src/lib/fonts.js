import { customFonts } from './textRender.js'

// Register an imported font file so canvas text can use it by name.
export async function loadFont(id, name, url) {
  const face = new FontFace(name, `url(${url})`)
  await face.load()
  document.fonts.add(face)
  customFonts.set(id, { name })
}

export const fontNameFromFile = (file) =>
  file.name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'Custom font'

export const fontExt = (file) => (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'ttf').toLowerCase()
