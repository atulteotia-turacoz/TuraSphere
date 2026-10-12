import React from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

/**
 * Read-only renderer for rich-text HTML authored in the Quill editors
 * (survey description + "Add content → Text" blocks).
 *
 * We render through a read-only Quill instance — the SAME engine used to author
 * the content — instead of dangerouslySetInnerHTML. Quill re-parses the saved
 * HTML and rebuilds its own DOM (including the list marker spans it needs), so
 * the output is pixel-identical to what was typed: ordered/bullet lists with
 * proper hanging numbers, alignment, indent, fonts, sizes, etc. Trying to
 * reproduce all of Quill's list/align CSS by hand is brittle; this is exact.
 */
export default function RichTextView({ html, className = '', style }) {
  return (
    <ReactQuill
      className={`rich-text-view ${className}`.trim()}
      value={html || ''}
      readOnly
      theme="snow"
      modules={{ toolbar: false }}
      style={style}
    />
  );
}
