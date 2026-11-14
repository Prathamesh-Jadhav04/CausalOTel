import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'causalotel-theme';
const VALID_THEMES = ['dark', 'light'];

const ThemeContext = createContext(null);

function readInitialTheme() {
  if (typeof document !== 'undefined') {
    const attribute = document.documentElement.getAttribute('data-theme');
    if (VALID_THEMES.includes(attribute)) return attribute;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (VALID_THEMES.includes(stored)) return stored;
  } catch (error) { /* storage unavailable */ }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitialTheme);
  const previousTheme = useRef(theme);
  const animTimer = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    const changed = previousTheme.current !== theme;
    previousTheme.current = theme;

    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#000000');

    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) { /* storage unavailable */ }

    if (changed) {
      root.classList.add('theme-anim');
      window.clearTimeout(animTimer.current);
      animTimer.current = window.setTimeout(() => root.classList.remove('theme-anim'), 340);
    }

    return () => window.clearTimeout(animTimer.current);
  }, [theme]);

  const updateTheme = useCallback((next) => {
    setTheme((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      return VALID_THEMES.includes(resolved) ? resolved : current;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({
    theme,
    setTheme: updateTheme,
    toggleTheme,
    isDark: theme === 'dark',
    isLight: theme === 'light'
  }), [theme, updateTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return context;
}
