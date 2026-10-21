// G05: palette only. Every colour is a custom property in the palette file; components read var(--ar-*).
export default {
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      'rgb',
      'rgba',
      'hsl',
      'hsla',
      'hwb',
      'lab',
      'lch',
      'oklab',
      'oklch',
      'color',
    ],
  },
  overrides: [
    {
      files: ['client/src/styles/tokens.css'],
      rules: { 'color-no-hex': null, 'color-named': null, 'function-disallowed-list': null },
    },
  ],
};
