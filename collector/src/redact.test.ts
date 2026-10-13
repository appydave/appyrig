import { describe, it, expect } from 'vitest';
import { REDACTED, redactDeep, redactString, redactWrapped } from './redact.js';

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

  it('Basic credentials: with an Authorization header or a credential-shaped value; plain prose is left alone', () => {
    expect(redactString('Authorization: Basic dXNlcjpwYXNz')).toBe(
      `Authorization: Basic ${REDACTED}`
    );
    expect(redactString('sent Basic dXNlcjpwYXNzd29yZDEyMw== to the proxy')).toContain(
      `Basic ${REDACTED}`
    );
    for (const calm of [
      'Basic authentication is enabled',
      'Basic configuration instructions follow',
      'the Basic Operating Procedure document',
    ]) {
      expect(redactString(calm), calm).toBe(calm);
    }
  });

  it('Tailscale auth keys never survive', () => {
    for (const k of [
      'tskey-auth-k1AbCdEf11CNTRL-9gXyZaBcDeFgHiJkLmNoPqRsTuVwXy',
      'tskey-api-kABCDEFGHIJKLMN-0123456789abcdef',
      'tskey-client-kABCDEF123456CNTRL-abcdefghijklmnop',
    ]) {
      const out = redactString(`use ${k} to join`);
      expect(out, k).not.toContain(k.slice(10));
      expect(out).toContain(REDACTED);
    }
    expect(redactString('the tskey- prefix is documented')).toBe('the tskey- prefix is documented');
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

describe('fix-first F2 (security #4, #5): more prefixes, ANSI, wrapped tokens', () => {
  // Fake strings only, built so no real-looking secret sits in the source as one literal.
  const tok110 = `sk-ant-oat01-${'Ab3dEf5hIj7lMn9pQr1tUv3xYz5'.repeat(4)}`.slice(0, 110);
  const FIXTURES: Record<string, [string, string]> = {
    google: ['maps api AIza' + 'SyB-x9Kq2Lm7Np3Rt_6Vw8Yz1Bc5Df0Gh2X', 'Rt_6Vw8'],
    stripeRk: ['STRIPE=rk_' + 'live_51H8xYzAbCdEfGhIjKl', 'rk_live_51H8'],
    stripeSk: ['use sk_' + 'live_4eC39HqLyjWDarjtT1zdp7dc now', 'sk_live_4eC3'],
    stripeTest: ['sk_' + 'test_4eC39HqLyjWDarjtT1zdp7dc', 'sk_test_4eC3'],
    npm: [
      '//registry.npmjs.org/:_authToken npm_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
      'npm_a1B2',
    ],
    slack: [
      'curl -X POST https://hooks.slack.com/services/' +
        'T0123ABCD/B0456EFGH/xYz123AbC456dEf789GhI0',
      'xYz123AbC456',
    ],
    mysql: ['mysql -u root -p' + 'Sup3rS3cret! mydb', 'Sup3rS3cret'],
    mysqldump: ['mysqldump -h db -u admin -p' + 'hunter2xyz shop > x.sql', 'hunter2xyz'],
    urlNoUser: ['git clone https://:' + 'ghx9Secretpass@git.example.com/r.git', 'ghx9Secretpass'],
  };

  for (const [name, [text, leak]] of Object.entries(FIXTURES)) {
    it(`redacts ${name}`, () => {
      const out = redactString(text);
      expect(out).toContain(REDACTED);
      expect(out).not.toContain(leak);
    });
  }

  it('a bare mysql -p (prompts for the password) and ordinary -p flags are left alone', () => {
    expect(redactString('mysql -u root -p')).toBe('mysql -u root -p');
    expect(redactString('mkdir -p build/out')).toBe('mkdir -p build/out');
    expect(redactString('git log -p HEAD')).toBe('git log -p HEAD');
  });

  it('an ANSI colour code inside a token no longer hides it', () => {
    const coloured = `export TOKEN_X=1 \x1b[33m${tok110.slice(0, 40)}\x1b[0m\x1b[1m${tok110.slice(40)}\x1b[0m`;
    const out = redactString(coloured);
    expect(out).toContain(REDACTED);
    for (let i = 0; i + 12 <= tok110.length; i += 6)
      expect(out).not.toContain(tok110.slice(i, i + 12));
  });

  it('a coloured line without a secret keeps its colours', () => {
    const line = '\x1b[32m✓\x1b[0m 256 tests passed \x1b[2m(1.2s)\x1b[0m';
    expect(redactString(line)).toBe(line);
  });

  it('the 110-char sk-ant token is caught whole once joined (capture-pane -J), and leaks 0 chars', () => {
    const joined = `CLAUDE_CODE_OAUTH_TOKEN=${tok110}`;
    const out = redactString(joined);
    expect(out).toBe(`CLAUDE_CODE_OAUTH_TOKEN=${REDACTED}`);
  });
});

describe('F2 rework (QA HIGH-1): a token Claude Code hard-wrapped across rows', () => {
  // A fake: 97 random characters (letters, digits, '-', '_'), made for this test only.
  const body =
    'riGp_58WAm-dX3a5IDnOdcdbWB2dC4_DSDC6Lc1mxLpQ2yMK_Ye9FZ1wUVl4nuYV-d8fNYvvDbzDZST6IaXqA2h9Uz0-T1SaQ';
  const tok110 = `sk-ant-oat01-${body}`;
  expect(tok110).toHaveLength(110);

  /** Claude Code style: rows of `width`, each starting with a 2-space indent, hard newlines. */
  const tuiWrap = (text: string, width: number): string[] => {
    const rows: string[] = [];
    for (let i = 0; i < text.length; i += width - 2) rows.push(`  ${text.slice(i, i + width - 2)}`);
    return rows;
  };
  /** Longest run of the token's random body still on screen. */
  const leak = (out: string) => {
    let best = 0;
    for (let i = 0; i < body.length; i++)
      for (let j = body.length; j > i + best; j--)
        if (out.includes(body.slice(i, j))) {
          best = j - i;
          break;
        }
    return best;
  };
  const FORMS: Record<string, string> = {
    env: `export CLAUDE_CODE_OAUTH_TOKEN=${tok110}`,
    json: `{"accessToken": "${tok110}", "expiresAt": 1791860924079}`,
    bare: tok110,
  };

  for (const width of [80, 120])
    for (const [form, text] of Object.entries(FORMS))
      it(`${form} form at ${width} cols leaks nothing past chance (≤ 2 chars)`, () => {
        // A Claude pane draws full-width rules, so the widest row is the pane's width.
        const rule = '─'.repeat(width);
        const rows = [rule, '  Here is the file:', ...tuiWrap(text, width), '  That is all of it.'];
        const out = redactWrapped(rows).map(redactString).join('\n');
        expect(leak(out)).toBeLessThanOrEqual(2);
        expect(out).toContain(REDACTED);
        // Rows around the secret are untouched.
        expect(out.startsWith(`${rule}\n  Here is the file:\n`)).toBe(true);
        expect(out.endsWith('\n  That is all of it.')).toBe(true);
      });

  it('without the cross-row step the second row leaks (the bug)', () => {
    const rows = tuiWrap(FORMS.env!, 80);
    expect(leak(rows.map(redactString).join('\n'))).toBeGreaterThan(40);
  });

  it('wrapped prose, paths and long words that join into nothing secret are left exactly as they were', () => {
    const rows = [
      '  The collector reads ~/.claude/projects/-Users-davidcruwys-dev-ad-apps-appyrig-worktrees',
      '  /v15-loadout/40ad7aef.jsonl and pushes it to the hub every three seconds as before.',
      '  ✓ 256 tests passed',
      '  Supercalifragilisticexpialidocious',
      '  wordsalad continues here',
    ];
    expect(redactWrapped(rows)).toEqual(rows);
  });

  it('a coloured wrapped token is caught too, and only the rows it touches lose colour', () => {
    const rows = tuiWrap(FORMS.env!, 80).map((r) => `\x1b[33m${r}\x1b[0m`);
    const out = redactWrapped([...rows, '\x1b[32m✓ done\x1b[0m']).map(redactString);
    expect(leak(out.join('\n'))).toBeLessThanOrEqual(2);
    expect(out.at(-1)).toBe('\x1b[32m✓ done\x1b[0m');
  });
});
