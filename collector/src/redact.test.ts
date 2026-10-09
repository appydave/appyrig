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
