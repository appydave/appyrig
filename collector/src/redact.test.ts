import { describe, it, expect } from 'vitest';
import { REDACTED, redactDeep, redactString } from './redact.js';

const SECRETS = {
  gho: 'gho_16C7e42F292c6912E7710c838347Ae178B4a',
  ghp: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  pat: 'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789',
  sk: 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX',
  bearer: 'Authorization: Bearer abc123.def456-ghi789',
  hex64: 'a3f5c9d1e7b24680a3f5c9d1e7b24680a3f5c9d1e7b24680a3f5c9d1e7b24680',
  sha40: '0123456789abcdef0123456789abcdef01234567',
  authToken: 'auth_token=Zm9vYmFyYmF6cXV4MTIz',
  hook: 'hook-token: abcdef1234567890',
  resumeFlag: "claude --resume '3f2a9c1e-5b7d-4e21-9a0c-8d6f1b2c3e4f'",
  resumeCodex: 'codex resume 01a1166b-c782-75a1-bf28-4e9cb54ea8ed',
  aws: 'AKIAIOSFODNN7EXAMPLE',
  envKey: 'ANTHROPIC_API_KEY=sk_live_notapattern99',
  envSecret: 'export CLIENT_SECRET: "s3cr3tValue-xyz"',
  password: 'password: hunter2hunter2',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
};
const PAYLOAD: Record<string, string> = {
  gho: SECRETS.gho,
  ghp: SECRETS.ghp,
  pat: SECRETS.pat,
  sk: SECRETS.sk,
  bearer: 'abc123.def456-ghi789',
  hex64: SECRETS.hex64,
  sha40: SECRETS.sha40,
  authToken: 'Zm9vYmFyYmF6cXV4MTIz',
  hook: 'abcdef1234567890',
  resumeFlag: '3f2a9c1e-5b7d-4e21-9a0c-8d6f1b2c3e4f',
  resumeCodex: '01a1166b-c782-75a1-bf28-4e9cb54ea8ed',
  aws: SECRETS.aws,
  envKey: 'sk_live_notapattern99',
  envSecret: 's3cr3tValue-xyz',
  password: 'hunter2hunter2',
  jwt: 'eyJhbGciOiJIUzI1NiJ9',
};

describe('redaction filter (AC 19)', () => {
  it.each(Object.entries(SECRETS))('%s never survives', (name, text) => {
    const out = redactString(`before ${text} after`);
    expect(out).not.toContain(PAYLOAD[name]!);
    expect(out).toContain(REDACTED);
    expect(out.startsWith('before ')).toBe(true);
    expect(out.endsWith(' after')).toBe(true);
  });

  it('leaves ordinary text, short hex and the slug that merely contains sk- alone', () => {
    const plain =
      'git a1b2c3d, sk-analysis-brief, /Users/me/dev, ULID 01M4B5W1CN575YJD9K6JB3D3NC, session 3f2a9c1e-5b7d-4e21-9a0c-8d6f1b2c3e4f';
    expect(redactString(plain)).toBe(plain);
  });

  it('redacts every string leaf of a nested value, keeping shape and keys', () => {
    const v = { a: [`x ${SECRETS.gho}`, { b: SECRETS.sk }], n: 3, k: null, flag: true };
    const out = redactDeep(v);
    expect(JSON.stringify(out)).not.toContain(PAYLOAD.gho);
    expect(JSON.stringify(out)).not.toContain(SECRETS.sk);
    expect(out.n).toBe(3);
    expect(out.k).toBeNull();
    expect(Object.keys(out)).toEqual(['a', 'n', 'k', 'flag']);
  });
});

// v1.4 · r1 follow-up: whole message bodies are now shown, so unprefixed secrets must not pass.
// The AWS documentation example pair (not a real credential).
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

describe('redaction of unprefixed secrets in message bodies', () => {
  it.each([
    ['env style', `aws_secret_access_key = ${AWS_SECRET}`],
    ['json style', `{"aws_secret_access_key": "${AWS_SECRET}"}`],
    ['export', `export AWS_SECRET_ACCESS_KEY=${AWS_SECRET}`],
    ['prose', `the secret key is ${AWS_SECRET} so rotate it`],
    ['spaced label', `AWS secret access key: ${AWS_SECRET}`],
    ['quoted prose', `token "${AWS_SECRET}"`.replace('token', 'api token')],
    ['bare on its own line', `creds:\n${AWS_SECRET}\nend`],
    ['bare in a sentence', `I pasted ${AWS_SECRET} by mistake`],
    ['bare, quoted', `value='${AWS_SECRET}'`],
  ])('%s never survives', (_name, text) => {
    const out = redactString(text);
    expect(out).not.toContain(AWS_SECRET);
    expect(out).not.toContain('wJalrXUtnFEMI');
    expect(out).toContain(REDACTED);
  });

  it('the access key id and its secret together', () => {
    const out = redactString(
      `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=${AWS_SECRET}`
    );
    expect(out).not.toMatch(/AKIAIOSFODNN7EXAMPLE|wJalr/);
  });

  it('private key blocks, URL passwords and Basic credentials go; the label and user stay readable', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7n3m\nabcdEFGH1234\n-----END RSA PRIVATE KEY-----';
    expect(redactString(`key:\n${pem}\nthanks`)).not.toMatch(/MIIEow|abcdEFGH/);
    const url = redactString('clone https://david:hunter2pass@git.example.com/repo.git');
    expect(url).toContain('david:');
    expect(url).not.toContain('hunter2pass');
    expect(url).toContain('@git.example.com');
    expect(redactString('Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==')).not.toContain('dXNlcjpw');
  });

  it('leaves ordinary message text alone: paths, ids, versions, camelCase names, headings, tables', () => {
    const calm = [
      '/Users/davidcruwys/dev/ad/apps/appyrig-worktrees/v14-data/server/src/hub/fleetStore.ts:79',
      'qitem-20261011100715-4bfa5e6e and qitem-recovery-cac73b3d0192d3eb',
      'rig queue handoff-and-complete --to dev-qa@appyrig-v14 --tags mission:appyrig-v14',
      'useServerStatusHookReturnsRefetchOnReconnectValue',
      'ThisIsAVeryLongCamelCaseIdentifierNameWithoutDigits',
      '| Check | Result |\n|---|---|\n| lint | 0 |',
      'The secret to good review is reading the diff cold.',
      'api key rotation is tracked in the redeploy notes',
      'https://www.openrig.dev/help/agents and node v24.13.0',
      'commit 3403b41 and ba75f89 accepted',
    ];
    for (const text of calm) expect(redactString(text), text).toBe(text);
  });
});
