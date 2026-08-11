const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
}

const COLOR_ABBR: Record<string, string> = {
  W: '#f5f0d8',
  U: '#4aa8ff',
  B: '#8b90b5',
  R: '#ff5d73',
  G: '#3ddc97',
}

export function colorIdentityOf(colors: string | null): string {
  const letters = colors ? colors.replace(/\s/g, '').split('').filter((c) => c !== '') : []
  if (letters.length === 0) return 'Colorless'
  return letters.map((c) => COLOR_NAMES[c] ?? c).join(' ')
}

export function colorAbbr(colors: string | null): string {
  const letters = colors ? colors.replace(/\s/g, '').split('').filter((c) => c !== '') : []
  if (letters.length === 0) return 'C'
  return letters.join('')
}

export function colorSwatches(colors: string | null): string[] {
  const letters = colors ? colors.replace(/\s/g, '').split('').filter((c) => c !== '') : []
  if (letters.length === 0) return ['C']
  return letters
}

export function swatchBg(letter: string): string {
  return COLOR_ABBR[letter] ?? '#8b90b5'
}
