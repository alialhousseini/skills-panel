// The panel's pictures, as SVG text: no `$`, so the tests can read them.
// The desktop draws an SVG as an image, apart from the app's theme, so every
// colour here is a mid tone that reads on a light and on a dark background.

/** The three states every picture uses: on, off for this session, off here. */
export const COLORS = {
  on: '#2F9E68',
  session: '#E2A33A',
  off: '#9AA0AA',
  track: 'rgba(150,155,165,0.25)',
} as const

/**
 * Group colours, given by a group's place in the list so each keeps its colour.
 * None is green, amber or grey: those mean on and off.
 */
export const PALETTE = [
  '#5B8DEF',
  '#A06CD5',
  '#2EB5B0',
  '#E06C75',
  '#D9822B',
  '#7FA33A',
  '#D46BA8',
  '#4FA3D1',
  '#B8963A',
  '#8C7AE6',
] as const

export function paletteColor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length] ?? PALETTE[0]
}

export type Part = { value: number; color: string }

function fixed(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
}

/**
 * A rounded bar over a faint track, filled left to right by the parts. `of` is
 * the full scale (the sum of the parts when absent), so a bar can be part full.
 */
export function barSvg(parts: readonly Part[], width: number, height: number, of?: number): string {
  const sum = parts.reduce((total, part) => total + Math.max(0, part.value), 0)
  const scale = of !== undefined && of > 0 ? Math.max(of, sum) : sum
  const radius = fixed(height / 2)
  const pieces: string[] = []
  let x = 0
  for (const part of parts) {
    if (part.value <= 0 || scale <= 0) continue
    const w = (part.value / scale) * width
    pieces.push(`<rect x="${fixed(x)}" y="0" width="${fixed(w)}" height="${height}" fill="${part.color}"/>`)
    x += w
  }

  return svg(
    width,
    height,
    `<defs><clipPath id="b"><rect width="${width}" height="${height}" rx="${radius}"/></clipPath></defs>` +
      `<rect width="${width}" height="${height}" rx="${radius}" fill="${COLORS.track}"/>` +
      `<g clip-path="url(#b)">${pieces.join('')}</g>`,
  )
}

/** A ring split into the parts, clockwise from twelve o'clock, over a faint track. */
export function donutSvg(parts: readonly Part[], size: number, thickness: number): string {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const mid = fixed(size / 2)
  const ring = (color: string, extra: string) =>
    `<circle cx="${mid}" cy="${mid}" r="${fixed(r)}" fill="none" stroke="${color}" stroke-width="${thickness}"${extra}/>`
  const arcs: string[] = []
  let offset = 0
  for (const part of parts) {
    if (part.value <= 0 || total <= 0) continue
    const length = (part.value / total) * c
    arcs.push(
      ring(
        part.color,
        ` stroke-dasharray="${fixed(length)} ${fixed(c - length)}" stroke-dashoffset="${fixed(-offset)}" transform="rotate(-90 ${mid} ${mid})"`,
      ),
    )
    offset += length
  }

  return svg(size, size, ring(COLORS.track, '') + arcs.join(''))
}
