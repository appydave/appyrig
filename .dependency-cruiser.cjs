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
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist)' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
  },
};
