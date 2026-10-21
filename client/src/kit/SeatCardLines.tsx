import { useRef, useState } from 'react';
import { attachLine, copyText } from './WaitingOnDavid.js';
import { roleWord } from '../domain/fleet/model.js';

/**
 * D09 W3: what a seat card says about who the seat is. The role comes from its OpenRig agent_ref
 * (`implementer` → "builder"); key skills are AppyRig's per-seat allowlist, kept by the collector
 * only where the seat's own listing has them. Neither is shown when not reported.
 */
export function RoleTag({ agentRole }: { agentRole?: string | null }) {
  const word = roleWord(agentRole);
  if (!word) {
    return null;
  }

  return (
    <span
      className="seat-role"
      data-testid="seat-role"
      data-role={agentRole ?? undefined}
      title={`Role from its OpenRig agent_ref: ${agentRole}`}
    >
      {word}
    </span>
  );
}

const short = (n: string) => n.slice(n.lastIndexOf(':') + 1);

export function KeySkills({ skills }: { skills?: string[] }) {
  if (!skills?.length) {
    return null;
  }

  return (
    <span
      className="seat-key-skills"
      data-testid="seat-key-skills"
      title={`Key skills (from AppyRig's allowlist, all loaded in this seat): ${skills.join(', ')}`}
    >
      {skills.map((s) => (
        <span key={s} className="seat-key-skill">
          {short(s)}
        </span>
      ))}
    </span>
  );
}

/** v15 UI-A: figures never show 0 for "not reported": missing is an em dash. */
export const DASH = '—';

/** `119_000` → `119k`, `1_250_000` → `1.3M`, small numbers as they are; missing → `—`. */
export function tokensText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) {
    return DASH;
  }
  if (n >= 999_500) {
    return `${(Math.round(n / 100_000) / 10).toString()}M`;
  }
  if (n >= 1000) {
    return `${Math.round(n / 1000)}k`;
  }

  return String(Math.round(n));
}

export function pctText(p: number | null | undefined): string {
  return p === null || p === undefined || !Number.isFinite(p) ? DASH : `${Math.round(p)}%`;
}

export type Harness = 'claude' | 'codex' | 'other';

/** Which harness runs a seat: from its runtime, falling back to the model name. */
export function harnessOf(
  runtime: string | null | undefined,
  model?: string | null
): { kind: Harness; label: string } {
  const r = (runtime ?? '').toLowerCase();
  const m = (model ?? '').toLowerCase();
  if (r.startsWith('claude') || (!r && m.startsWith('claude'))) {
    return { kind: 'claude', label: 'Claude' };
  }
  if (r === 'codex' || (!r && /^(gpt|codex|o\d)/.test(m))) {
    return { kind: 'codex', label: 'Codex' };
  }

  return { kind: 'other', label: r && r !== 'unknown' ? r : DASH };
}

/** A small mark, drawn here (no logo files): a spark for Claude, brackets for Codex, a prompt otherwise. */
export function HarnessMark({
  runtime,
  model,
}: {
  runtime?: string | null;
  model?: string | null;
}) {
  const h = harnessOf(runtime, model);

  return (
    <span
      className="harness-mark mono"
      data-testid="seat-harness"
      data-harness={h.kind}
      title={`Harness: ${h.label}`}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
        {h.kind === 'claude' ? (
          <path
            d="M8 1v14M1 8h14M3 3l10 10M13 3L3 13"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        ) : h.kind === 'codex' ? (
          <path
            d="M5.5 3.5L1.5 8l4 4.5M10.5 3.5l4 4.5-4 4.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : (
          <path
            d="M2 3.5h12v9H2zM4.5 6.5l2 1.5-2 1.5M8 10h3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
      </svg>
      {h.label}
    </span>
  );
}

/** `12%   119k`: context used and tokens, each `—` when not reported. */
export function ContextLine({ pct, tokens }: { pct?: number | null; tokens?: number | null }) {
  return (
    <span
      className="seat-context mono"
      data-testid="seat-context"
      title="Context used, and tokens in the context (from OpenRig)"
    >
      <span data-testid="seat-context-pct">{pctText(pct)}</span>
      <span data-testid="seat-context-tokens">{tokensText(tokens)}</span>
    </span>
  );
}

/** The seat's mailbox address (its session name), in monospace. */
export function Address({ id }: { id: string }) {
  return (
    <span className="seat-address mono" data-testid="seat-address" title="Mailbox address">
      {id}
    </span>
  );
}

/**
 * Copies the attach line (WaitingOnDavid's `attachLine`: quoted, ssh-wrapped for another machine);
 * never runs it. No line (an unsafe session name) means no button. When the browser blocks copying
 * (plain http), the line is shown and selected so ⌘C works.
 */
export function CopyAttach({ session, ssh }: { session: string; ssh: string | null }) {
  const [said, setSaid] = useState<'copied' | 'select' | null>(null);
  const lineEl = useRef<HTMLElement>(null);
  const line = attachLine(session, ssh);
  if (!line) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="copy-attach"
        data-testid="copy-attach"
        onClick={(e) => {
          e.stopPropagation();
          void copyText(line).then((ok) => {
            if (!ok) {
              const el = lineEl.current;
              const sel = window.getSelection();
              if (el && sel) {
                const range = document.createRange();
                range.selectNodeContents(el);
                sel.removeAllRanges();
                sel.addRange(range);
              }
            }
            setSaid(ok ? 'copied' : 'select');
            if (ok) {
              setTimeout(() => setSaid(null), 1500);
            }
          });
        }}
        title={line}
      >
        {said === 'copied' ? 'copied' : 'copy attach'}
      </button>
      {said === 'select' && (
        <span className="copy-select" role="status" data-testid="copy-attach-select">
          select and ⌘C:{' '}
          <code ref={lineEl} className="mono" data-testid="copy-attach-line">
            {line}
          </code>
        </span>
      )}
    </>
  );
}
