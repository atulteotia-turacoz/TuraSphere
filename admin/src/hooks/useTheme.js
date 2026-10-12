import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'turaquant-theme';

/** Read the theme the inline script in index.html already resolved and applied. */
function readTheme() {
  if (typeof document === 'undefined') return 'light';
  const applied = document.documentElement.getAttribute('data-theme');
  if (applied === 'dark' || applied === 'light') return applied;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch (e) {
    // Private mode / storage blocked — fall through to the OS preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Whether the user has made an explicit choice, or is still following the OS. */
function hasExplicitChoice() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch (e) {
    return false;
  }
}

/**
 * Light/dark theme, persisted per browser.
 *
 * The initial value is resolved by an inline script in index.html rather than
 * here, so the page paints in the right colours before React mounts — otherwise
 * a dark-theme user gets a white flash on every load.
 */
export default function useTheme() {
  const [theme, setThemeState] = useState(readTheme);

  // Reflect onto <html> so every `[data-theme='dark']` rule applies at once.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Follow the OS only while the user has not chosen for themselves.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = (e) => {
      if (!hasExplicitChoice()) setThemeState(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Keep other tabs of the app in sync.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
        setThemeState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {
      // Storage unavailable — the choice still applies for this page view.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (e) {
        // As above.
      }
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' };
}
