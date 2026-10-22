/**
 * AC 12 (imports half). Strings half: scripts/arch-strings.mjs.
 * G12: every layer rule is `reachable: true`, so a layer cannot reach a forbidden one through an
 * intermediate module either (mirrors Omer's 6c9cc9e). Production code is src/ minus tests and test support.
 */
const PRODUCTION = {
  path: '^(client|server|collector|shared)/src/',
  pathNot: ['\\.(test|spec)\\.[cm]?[jt]sx?$', '(^|/)test/', 'test-kit'],
};

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'Two modules that import each other (directly or through others) cannot be loaded or tested alone. Move what both need into a third module that neither of them imports from. Type-only and dynamic imports do not count.',
      severity: 'error',
      from: {},
      to: {
        circular: true,
        viaOnly: { dependencyTypesNot: ['type-only', 'pre-compilation-only', 'dynamic-import'] },
      },
    },
    {
      name: 'client-not-server-or-collector',
      comment:
        'The browser app never loads server or collector code, directly or through another module. Put what both need in shared/ and import it from there.',
      severity: 'error',
      from: { path: '^client/' },
      to: { path: '^(server|collector)/', reachable: true },
    },
    {
      name: 'collector-not-server-or-client',
      comment:
        'The collector never loads server or client code, directly or through another module. Put what both need in shared/ and import it from there.',
      severity: 'error',
      from: { path: '^collector/' },
      to: { path: '^(server|client)/', reachable: true },
    },
    {
      name: 'server-not-client-or-collector',
      comment:
        'The server never loads client or collector code, directly or through another module. Put what both need in shared/ and import it from there.',
      severity: 'error',
      from: { path: '^server/' },
      to: { path: '^(client|collector)/', reachable: true },
    },
    {
      name: 'shared-imports-nothing-local',
      comment:
        'shared/ is the bottom layer: it never loads server, client or collector code, directly or through another module. Move the code it needs down into shared/.',
      severity: 'error',
      from: { path: '^shared/' },
      to: { path: '^(server|client|collector)/', reachable: true },
    },
    // The client is one codebase in layers: app → shell, pages → kit → domain.
    // Business logic lives in domain/; screens only wire it.
    {
      name: 'client-domain-has-no-ui',
      comment:
        'domain/ is business logic: it never imports a screen, the kit, the shell or the app, nor any .tsx',
      severity: 'error',
      from: { path: '^client/src/domain/', pathNot: '\\.test\\.tsx?$' },
      to: { path: ['^client/src/(app|shell|pages|kit)/', '\\.tsx$'], reachable: true },
    },
    {
      name: 'client-kit-has-no-screens',
      comment:
        'kit/ is shared UI: it never imports a page, the shell or the app (types from app/types.ts are fine)',
      severity: 'error',
      from: { path: '^client/src/kit/', pathNot: '\\.test\\.tsx?$' },
      to: { path: '^client/src/(shell|pages)/|^client/src/app/(?!types\\.ts$)', reachable: true },
    },
    {
      name: 'not-to-dev-dep',
      comment:
        'Production code cannot import a devDependency: it would be missing in a production install. Move the package to dependencies, or keep the import in a test.',
      severity: 'error',
      from: PRODUCTION,
      to: {
        dependencyTypes: ['npm-dev'],
        dependencyTypesNot: ['type-only', 'pre-compilation-only'],
      },
    },
    {
      name: 'not-to-spec',
      comment:
        'Production code cannot import a test, a test helper or a fixture. Move what it needs out of the test folder into the code that uses it.',
      severity: 'error',
      from: PRODUCTION,
      to: { path: ['\\.(test|spec)\\.[cm]?[jt]sx?$', '(^|/)test/', 'test-kit', '^(e2e|lint)/'] },
    },
    // dependency-cruiser's own rule (configs/rules/no-deprecated-core.cjs, whose path is not importable).
    // Omer has it as a warning; a warning is a suggestion an agent ignores, so here it fails the build.
    {
      name: 'no-deprecated-core',
      comment:
        'This module depends on a node core module that has been deprecated. Use its replacement (for example the URL class instead of punycode).',
      severity: 'error',
      from: {},
      to: {
        dependencyTypes: ['core'],
        path: '^(?:punycode|domain|constants|sys|_linklist|_stream_wrap)$',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)dist/' },
    // Resolves the @client/@server/... aliases, so the boundary rules still see aliased imports.
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: 'specify',
    combinedDependencies: true,
  },
};
