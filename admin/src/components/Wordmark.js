import React from 'react';
import logo from '../assets/turasphere-logo.png';
import logoDark from '../assets/turasphere-logo-dark.png';

/**
 * The TuraSphere logo.
 *
 * Was a CSS-drawn wordmark (Quicksand, two-tone green) standing in for the real
 * logotype. This renders the actual artwork, so every surface shows the same
 * mark rather than an approximation of it.
 *
 * Two files, swapped by CSS on `[data-theme]`:
 *   - the supplied artwork, near-black ink, for light backgrounds;
 *   - a dark-mode variant with the INK ONLY lifted to light grey. The orange
 *     sphere is byte-for-byte identical between the two — an earlier attempt
 *     used `filter: invert()`, which flipped the sphere blue.
 *
 * The swap is CSS rather than JS so the logo cannot flash the wrong variant on
 * a theme change or a first paint.
 *
 * The files are transparent PNGs at 2907x540 (~5.4:1). Only the height is set
 * and the width is left to follow, so a caller's layout cannot squash the
 * aspect ratio. `suffix` renders the product qualifier ("Admin"), which is a tag
 * beside the logo and never part of the logotype.
 */
export default function Wordmark({ suffix, className = '', height }) {
  const style = height ? { height } : undefined;
  return (
    <span className={`wordmark ${className}`.trim()}>
      <img src={logo} alt="TuraSphere" className="wordmark-img wordmark-img-light" style={style} />
      <img src={logoDark} alt="" aria-hidden="true" className="wordmark-img wordmark-img-dark" style={style} />
      {suffix && <span className="wordmark-suffix">{suffix}</span>}
    </span>
  );
}
