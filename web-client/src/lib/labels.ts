/** Human labels for degree levels. The roster uses BTECH/MTECH/PHD. */

export type DegreeKey = 'BTECH' | 'MTECH' | 'PHD'

export const DEGREE_LABELS: Record<DegreeKey, string> = {
  BTECH: 'B.Tech',
  MTECH: 'M.Tech',
  PHD: 'PhD',
}

/** `'MTECH'` → `'M.Tech'`; unknown/NULL values are passed through (or null stays null). */
export function degreeLabel(level: string | null | undefined): string | null {
  if (!level) return null
  const key = level.toUpperCase() as DegreeKey
  return DEGREE_LABELS[key] ?? level
}
