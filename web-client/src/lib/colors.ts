const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
}

// Same palette as the --mana-* tokens in index.css.
const COLOR_ABBR: Record<string, string> = {
  W: '#efe3bd',
  U: '#2f6fb3',
  B: '#3d3235',
  R: '#c9302c',
  G: '#2f7d3a',
}

export function colorIdentityOf(colors: string | null): string {
  const letters = colors ? colors.replace(/\s/g, '').split('').filter((c) => c !== '') : []
  if (letters.length === 0) return 'Colorless'
  return letters.map((c) => COLOR_NAMES[c] ?? c).join(' ')
}

export function colorSwatches(colors: string | null): string[] {
  const letters = colors ? colors.replace(/\s/g, '').split('').filter((c) => c !== '') : []
  if (letters.length === 0) return ['C']
  return letters
}

export function swatchBg(letter: string): string {
  return COLOR_ABBR[letter] ?? '#a1968a'
}

/** Readable text color on a swatch: dark on white/colorless, white on the rest. */
export function swatchFg(letter: string): string {
  return letter === 'W' || !COLOR_ABBR[letter] ? '#3b2a12' : '#fff'
}
