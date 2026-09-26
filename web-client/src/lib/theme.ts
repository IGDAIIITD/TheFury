/**
 * Light (parchment) or dark (dark brown) theme. The choice is stored per device; index.html
 * applies it before first paint so there's no flash of the light theme.
 */
export type Theme = 'light' | 'dark'

export const THEME_KEY = 'cf_theme'

const THEME_COLOR: Record<Theme, string> = { light: '#b3202b', dark: '#1d1611' }

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // storage unavailable: the theme lasts for this page only
  }
}
