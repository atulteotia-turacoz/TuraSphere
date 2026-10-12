import React from 'react';
import mark from '../assets/turasphere-mark.png';

/**
 * The sphere on its own — the "o" of the turasphere logotype.
 *
 * Used where the full wordmark does not fit: the collapsed sidebar, and any
 * square slot. Both of those previously showed a generic lucide `Activity`
 * glyph, which is not the brand at all; at 76px wide the collapsed rail was the
 * only mark some users ever saw.
 */
export default function LogoMark({ size = 24, className = '', style }) {
  return (
    <img
      src={mark}
      alt=""
      aria-hidden="true"
      className={`logo-mark ${className}`.trim()}
      style={{ width: size, height: size, flexShrink: 0, ...style }}
    />
  );
}
