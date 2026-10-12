import React from 'react';

/**
 * Renders a survey question label that may contain pasted inline markup.
 *
 * Question labels are authored in a plain <input>, so they are normally plain text
 * and must render as such — escaping "<" and "&" the way React already does. But
 * authors do paste inline markup (a red asterisk, a superscript), and rendering
 * that as a JSX expression showed it verbatim as code.
 *
 * Quill's read-only view (components/RichTextView) can't render these: it parses
 * into its own document model, which drops class names and discards empty elements
 * — exactly what an `<i class="fa fa-asterisk"></i>` icon is. So labels containing
 * markup are sanitized to a small inline whitelist and injected directly.
 *
 * Shared by the public survey page and the edit-page preview so the author sees
 * exactly what a respondent will.
 */

const HTML_TAG_RE = /<\/?[a-z][\s\S]*>/i;
export const looksLikeHtml = (s) => typeof s === 'string' && HTML_TAG_RE.test(s);

// Inline formatting only — no block, no media, no script, no event handlers.
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUP', 'SUB', 'SPAN', 'SMALL', 'BR']);
const ALLOWED_STYLE_PROPS = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'font-size'];
// Everything else is unwrapped (its text survives); these are dropped whole, so
// script/style source never leaks out as visible text.
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

export function sanitizeInlineHtml(html) {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstChild;

  const walk = (parent) => {
    Array.from(parent.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); return; }

      if (DROP_WITH_CONTENT.has(node.tagName)) { node.remove(); return; }

      if (!ALLOWED_TAGS.has(node.tagName)) {
        // Unwrap rather than delete, so the text inside a stray tag survives.
        walk(node);
        node.replaceWith(...node.childNodes);
        return;
      }

      // Keep only whitelisted style declarations (already parsed by the browser,
      // so no hand-rolled CSS parsing) and `fa-*` classes for icon glyphs.
      const style = ALLOWED_STYLE_PROPS
        .map((p) => [p, node.style.getPropertyValue(p)])
        .filter(([, v]) => v);
      const faClasses = Array.from(node.classList).filter((c) => /^fa[a-z]?(-|$)/.test(c));

      Array.from(node.attributes).forEach((a) => node.removeAttribute(a.name));
      style.forEach(([p, v]) => node.style.setProperty(p, v));
      if (faClasses.length) node.setAttribute('class', faClasses.join(' '));

      walk(node);
    });
  };
  walk(root);
  return root.innerHTML;
}

export default function InlineRichText({ text }) {
  if (!looksLikeHtml(text)) return text ?? null;
  return <span dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(text) }} />;
}
