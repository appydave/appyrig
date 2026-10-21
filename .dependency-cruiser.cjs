/** AC 12 (imports half). Strings half: scripts/arch-strings.mjs. */
module.exports = {
  forbidden: [
    {
      name: 'client-not-server-or-collector',
      severity: 'error',
      from: { path: '^client/' },
      to: { path: '^(server|collector)/' },
    },
    {
      name: 'collector-not-server-or-client',
      severity: 'error',
      from: { path: '^collector/' },
      to: { path: '^(server|client)/' },
    },
    {
      name: 'server-not-client-or-collector',
      severity: 'error',
      from: { path: '^server/' },
      to: { path: '^(client|collector)/' },
    },
    {
      name: 'shared-imports-nothing-local',
      severity: 'error',
      from: { path: '^shared/' },
      to: { path: '^(server|client|collector)/' },
    },
    // The client is one codebase in layers: app → shell, pages → kit → domain.
    // Business logic lives in domain/; screens only wire it.
    {
      name: 'client-domain-has-no-ui',
      comment:
        'domain/ is business logic: it never imports a screen, the kit, the shell or the app, nor any .tsx',
      severity: 'error',
      from: { path: '^client/src/domain/', pathNot: '\\.test\\.tsx?$' },
      to: { path: ['^client/src/(app|shell|pages|kit)/', '\\.tsx$'] },
    },
    {
      name: 'client-kit-has-no-screens',
      comment:
        'kit/ is shared UI: it never imports a page, the shell or the app (types from app/types.ts are fine)',
      severity: 'error',
      from: { path: '^client/src/kit/', pathNot: '\\.test\\.tsx?$' },
      to: { path: '^client/src/(shell|pages)/|^client/src/app/(?!types\\.ts$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist)' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
  },
};
