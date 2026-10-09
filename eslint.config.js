import appyConfig from '@appydave/appystack-config/eslint/react';

// OpenRig drops its own runtime files into every seat folder (git-excluded); they are not ours.
const openRigFiles = ['.openrig/**', '.claude/**', '.agents/**', '.codex/**', 'test/fixtures/**'];

export default [{ ignores: openRigFiles }, ...appyConfig];
