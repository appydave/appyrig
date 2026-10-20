import appyConfig from '@appydave/appystack-config/eslint/react';

// OpenRig drops its own runtime files into every seat folder (git-excluded); they are not ours.
const openRigFiles = ['.openrig/**', '.claude/**', '.agents/**', '.codex/**', 'test/fixtures/**'];

// Vendored fli-core files keep upstream bytes (server/src/core/vendor/LICENSE). So do the OpenRig
// files copied into test/root/fixtures for the provenance check (Apache-2.0).
const vendored = ['server/src/core/vendor/**', 'test/root/fixtures/**'];

export default [{ ignores: [...openRigFiles, ...vendored] }, ...appyConfig];
