import React from 'react';
import { Sun, Moon } from 'lucide-react';
import useTheme from '../../hooks/useTheme';

/**
 * Light/dark switch.
 *
 * A two-state button rather than a three-way light/dark/system control: the
 * client asked for "click dark → dark, click light → light", and the OS
 * preference is still honoured as the starting value until they choose.
 */
export default function ThemeToggle({ className = '' }) {
  const { isDark, toggleTheme } = useTheme();
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      aria-pressed={isDark}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <span className="theme-toggle-thumb">
          {isDark ? <Moon size={13} /> : <Sun size={13} />}
        </span>
      </span>
    </button>
  );
}
