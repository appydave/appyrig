// G05: palette only. A colour is a custom property in client/src/styles/tokens.css; code reads var(--ar-*).
// Retargets Omer's strict-colors rule (a typed three.js plugin) to AppyRig's palette: CSS custom properties.
// CSS files are checked by Stylelint (stylelint.config.mjs); this covers colour strings in TypeScript.
const message = 'Use a colour from the palette (client/src/styles/tokens.css), not a literal.';
const HEX = '^#([\\da-f]{3,4}|[\\da-f]{6}|[\\da-f]{8})$';
const FUNCTION = '^(rgb|hsl|hwb|lab|lch|oklab|oklch)a?\\(';

export const colorSelectors = [
  { selector: `Literal[value=/${HEX}/i]`, message },
  { selector: `Literal[value=/${FUNCTION}/i]`, message },
  { selector: `TemplateElement[value.raw=/${FUNCTION}/i]`, message },
];
