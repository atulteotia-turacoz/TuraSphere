import { createGlobalStyle } from 'styled-components';

import colors from './variables/colors';

export default createGlobalStyle`
  * {
    margin: 0;
    padding: 0;
    outline: 0;
    box-sizing: border-box;
  }

  html,
  body,
  #root {
    height: 100%;
    font-family: 'Roboto', 'Segoe UI', Verdana, Arial, sans-serif;
    background: ${colors.bgColor};
    color: ${colors.text.light.medium};
  }

  body {
    -webkit-font-smoothing: antialiased;
  }

  body,
  input,
  button {
    font: 14px 'Roboto', 'Segoe UI', Verdana, Arial, sans-serif;
  }

  *:focus {
    outline: 0;
  }

  a {
    text-decoration: none;
  }

  ul {
    list-style: none;
  }

  button {
    cursor: pointer;
  }

  /* Read-only rich-text view (components/RichTextView.js). Renders saved Quill
     HTML through a read-only Quill instance so it looks exactly like the editor.
     Strip the editor chrome (toolbar/border/padding) for inline display. */
  .rich-text-view .ql-toolbar {
    display: none;
  }
  .rich-text-view .ql-container.ql-snow {
    border: none;
    font-family: inherit;
    font-size: inherit;
  }
  .rich-text-view .ql-editor {
    padding: 0;
    line-height: 1.5;
    overflow: visible;
  }
  .rich-text-view .ql-editor a {
    color: var(--color-primary);
  }

`;
