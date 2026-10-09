import appyConfig from '@appydave/appystack-config/eslint/react';

// OpenRig drops its own runtime files into every seat folder (git-excluded); they are not ours.
const openRigFiles = ['.openrig/**', '.claude/**', '.agents/**', '.codex/**', 'test/fixtures/**'];

// Vendored fli-core files keep upstream bytes (server/src/core/vendor/LICENSE).
const vendored = ['server/src/core/vendor/**'];

export default [{ ignores: [...openRigFiles, ...vendored] }, ...appyConfig];
