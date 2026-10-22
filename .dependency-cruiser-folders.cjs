/**
 * G11: folder cycles. Mirrors Omer's lint/dependencies/runtime.json (spaghetti-busters 7f13d40): a folder
 * must not import a folder that imports it back, counting only code that runs (no tests, no type-only or
 * dynamic imports). Its options differ from .dependency-cruiser.cjs (which keeps tests and type imports to
 * judge the layer rules), so it is a second file. Run with `npm run arch:folders`.
 */
const SRC = '^(client|server|collector|shared)/src/';

module.exports = {
  forbidden: [
    {
      name: 'no-runtime-folder-cycles',
      comment:
        'Two folders that import each other cannot be understood or moved alone. Move the shared piece into a folder both can import from without it importing them back (for example a domain/ or lib/ folder).',
      severity: 'error',
      scope: 'folder',
      from: { path: SRC },
      to: { path: SRC, circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist)|\\.(test|spec)\\.tsx?$', dynamic: true },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: false,
  },
};
