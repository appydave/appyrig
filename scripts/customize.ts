import { intro, outro, text, cancel, isCancel } from '@clack/prompts';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function readFile(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf-8');
}

function writeFile(relPath: string, content: string): void {
  writeFileSync(resolve(ROOT, relPath), content, 'utf-8');
}

function replaceAll(content: string, from: string, to: string): string {
  return content.split(from).join(to);
}

async function main(): Promise<void> {
  intro('AppyStack Template Customization');

  const projectName = await text({
    message: 'Project name (e.g. my-app)',
    placeholder: 'my-app',
    validate(value) {
      if (!value || value.trim().length === 0) return 'Project name is required';
      if (!/^[a-z0-9-]+$/.test(value.trim()))
        return 'Use lowercase letters, numbers, and hyphens only';
    },
  });
  if (isCancel(projectName)) {
    cancel('Customization cancelled.');
    process.exit(0);
  }

  const packageScope = await text({
    message: 'Package scope (e.g. @myorg)',
    placeholder: '@myorg',
    validate(value) {
      if (!value || value.trim().length === 0) return 'Package scope is required';
      if (!value.trim().startsWith('@')) return 'Scope must start with @';
      if (!/^@[a-z0-9-]+$/.test(value.trim())) return 'Use @lowercase-letters-numbers-hyphens only';
    },
  });
  if (isCancel(packageScope)) {
    cancel('Customization cancelled.');
    process.exit(0);
  }

  const serverPortInput = await text({
    message: 'Server port',
    placeholder: '5501',
    initialValue: '5501',
    validate(value) {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        return 'Enter a valid port number (1–65535)';
    },
  });
  if (isCancel(serverPortInput)) {
    cancel('Customization cancelled.');
    process.exit(0);
  }

  const clientPortInput = await text({
    message: 'Client port',
    placeholder: '5500',
    initialValue: '5500',
    validate(value) {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        return 'Enter a valid port number (1–65535)';
    },
  });
  if (isCancel(clientPortInput)) {
    cancel('Customization cancelled.');
    process.exit(0);
  }

  const description = await text({
    message: 'Project description',
    placeholder: 'My awesome app',
    validate(value) {
      if (!value || value.trim().length === 0) return 'Description is required';
    },
  });
  if (isCancel(description)) {
    cancel('Customization cancelled.');
    process.exit(0);
  }

  const name = (projectName as string).trim();
  const scope = (packageScope as string).trim();
  const serverPort = (serverPortInput as string).trim();
  const clientPort = (clientPortInput as string).trim();
  const desc = (description as string).trim();

  const oldScope = '@appydave';
  const oldRootName = '@appydave/appystack-template';
  const oldServerPort = '5501';
  const oldClientPort = '5500';
  const oldTitle = 'AppyStack Template';
  const oldDescription = 'RVETS stack boilerplate (React, Vite, Express, TypeScript, Socket.io)';

  // --- Root package.json ---
  let rootPkg = readFile('package.json');
  rootPkg = replaceAll(rootPkg, oldRootName, `${scope}/${name}`);
  rootPkg = replaceAll(rootPkg, oldDescription, desc);
  writeFile('package.json', rootPkg);

  // --- shared/package.json ---
  let sharedPkg = readFile('shared/package.json');
  sharedPkg = replaceAll(sharedPkg, oldScope, scope);
  writeFile('shared/package.json', sharedPkg);

  // --- server/package.json ---
  let serverPkg = readFile('server/package.json');
  serverPkg = replaceAll(serverPkg, oldScope, scope);
  writeFile('server/package.json', serverPkg);

  // --- client/package.json ---
  let clientPkg = readFile('client/package.json');
  clientPkg = replaceAll(clientPkg, oldScope, scope);
  writeFile('client/package.json', clientPkg);

  // --- .env.example ---
  let envExample = readFile('.env.example');
  envExample = replaceAll(envExample, `PORT=${oldServerPort}`, `PORT=${serverPort}`);
  envExample = replaceAll(
    envExample,
    `CLIENT_URL=http://localhost:${oldClientPort}`,
    `CLIENT_URL=http://localhost:${clientPort}`
  );
  writeFile('.env.example', envExample);

  // --- server/src/config/env.ts ---
  let envTs = readFile('server/src/config/env.ts');
  envTs = replaceAll(
    envTs,
    `PORT: z.coerce.number().default(${oldServerPort})`,
    `PORT: z.coerce.number().default(${serverPort})`
  );
  envTs = replaceAll(
    envTs,
    `CLIENT_URL: z.string().default('http://localhost:${oldClientPort}')`,
    `CLIENT_URL: z.string().default('http://localhost:${clientPort}')`
  );
  writeFile('server/src/config/env.ts', envTs);

  // --- client/vite.config.ts ---
  let viteConfig = readFile('client/vite.config.ts');
  viteConfig = replaceAll(viteConfig, `port: ${oldClientPort}`, `port: ${clientPort}`);
  viteConfig = replaceAll(
    viteConfig,
    `target: 'http://localhost:${oldServerPort}'`,
    `target: 'http://localhost:${serverPort}'`
  );
  writeFile('client/vite.config.ts', viteConfig);

  // --- client/index.html ---
  let indexHtml = readFile('client/index.html');
  indexHtml = replaceAll(indexHtml, `<title>${oldTitle}</title>`, `<title>${name}</title>`);
  writeFile('client/index.html', indexHtml);

  // --- scripts/start.sh ---
  let startSh = readFile('scripts/start.sh');
  startSh = replaceAll(startSh, `:${oldServerPort}`, `:${serverPort}`);
  startSh = replaceAll(startSh, `localhost:${oldClientPort}`, `localhost:${clientPort}`);
  startSh = replaceAll(startSh, `client: ${oldClientPort}, server: ${oldServerPort}`, `client: ${clientPort}, server: ${serverPort}`);
  startSh = replaceAll(startSh, `ports ${oldClientPort}/${oldServerPort}`, `ports ${clientPort}/${serverPort}`);
  startSh = replaceAll(startSh, oldTitle, name);
  writeFile('scripts/start.sh', startSh);

  outro(
    `Done! Project customized as "${scope}/${name}". Run "npm install" to update the workspace symlinks.`
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
