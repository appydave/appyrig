import { useEffect, useState } from 'react';
import type { FleetMachine, QueueItem, RigWaitingOutput } from '@appydave/shared';
import { callVerb } from '../fleet/coreCall.js';
import type { FleetSocket } from '../fleet/useFleet.js';

interface Props {
  machine: FleetMachine;
  rig: string;
  /** Open items a seat of this rig addressed to David's mailbox, newest first (runCard.toDavid). */
  toDavid: QueueItem[];
  socket?: FleetSocket;
  /**
   * D09 W0 (QA MEDIUM-1): how many open gates this shows, so the run card's one line counts them
   * too. 'loading' while asking; null when the hub did not answer (gates not checked).
   */
  onGates?: (n: number | null | 'loading') => void;
}

const SHOWN = 5;
const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const who = (raw: string | null) => (raw ?? '?').split('@')[0];

/** The copyable line that attaches David to a seat's terminal. Shown, never run. */
export function attachLine(session: string, ssh: string | null): string | null {
  // r1 R2 LOW-2: David pastes this into a shell; a name a shell would read gets no line at all.
  if (!SAFE_SESSION.test(session)) return null;
  const local = `tmux attach -t '${session}'`;
  return ssh ? `ssh -t ${ssh} "${local}"` : local;
}

const SAFE_SESSION = /^[A-Za-z0-9@._-]+$/;

/**
 * Puts text on the clipboard. The clipboard API needs a secure page (https or localhost); the
 * real URL is plain http over Tailscale, so fall back to a hidden textarea and execCommand.
 * QA R2 MEDIUM-1: never silent; false means "select it and press ⌘C".
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the old way
    }
  }
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.opacity = '0';
  document.body.appendChild(box);
  box.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  box.remove();
  return ok;
}

function Copy({
  text,
  label,
  target,
}: {
  text: string;
  label: string;
  target: () => Element | null;
}) {
  const [said, setSaid] = useState<'copied' | 'select' | null>(null);
  // r1 INFO-1: "Copied" goes back to "Copy" after a moment.
  useEffect(() => {
    if (said !== 'copied') return;
    const t = setTimeout(() => setSaid(null), 2000);
    return () => clearTimeout(t);
  }, [said]);
  return (
    <>
      <button
        type="button"
        className="pill-btn copy-btn"
        data-testid="run-copy"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void copyText(text).then((ok) => {
            if (!ok) {
              // Select the line itself so ⌘C works, and say so.
              const el = target();
              const sel = window.getSelection();
              if (el && sel) {
                const range = document.createRange();
                range.selectNodeContents(el);
                sel.removeAllRanges();
                sel.addRange(range);
              }
            }
            setSaid(ok ? 'copied' : 'select');
          });
        }}
      >
        {said === 'copied' ? 'Copied' : 'Copy'}
      </button>
      {said === 'select' && (
        <span className="run-from" role="status" data-testid="run-copy-select">
          {' '}
          The browser blocked copying on this page (plain http): the line is selected, press ⌘C.
        </span>
      )}
    </>
  );
}

/**
 * Run card R2: what the rig waits on David for. Open items its seats sent to his mailbox, each with
 * a copyable attach line for the seat that asked, and FliStudio gates its handoffs still call open,
 * with the link a handoff carried. Nothing here acts: links open FliStudio, buttons only copy text.
 */
export default function WaitingOnDavid({ machine, rig, toDavid, socket, onGates }: Props) {
  const [w, setW] = useState<RigWaitingOutput | null | 'loading'>('loading');
  const machineId = machine.machine.id;
  useEffect(() => {
    setW('loading');
    if (!socket) {
      setW(null);
      return;
    }
    let live = true;
    void callVerb<RigWaitingOutput>(socket, 'rig.waiting', { machine: machineId, rig }).then(
      (a) => live && setW(a.ok ? a.value : null)
    );
    return () => {
      live = false;
    };
  }, [socket, machineId, rig]);

  const got = w === 'loading' ? null : w;
  const gates = got?.gates ?? [];
  const gateCount = w === 'loading' ? 'loading' : w === null ? null : gates.length;
  useEffect(() => {
    onGates?.(gateCount);
  }, [onGates, gateCount]);
  const seats = new Set(machine.snapshot.seats.map((s) => s.id));
  const label = machine.machine.label;

  if (!toDavid.length && !gates.length) {
    return (
      <p className="run-from" data-testid="run-waiting-none">
        {w === 'loading'
          ? 'reading its handoffs for open gates…'
          : `Nothing waiting on David: no open item from this rig to his mailbox${got ? ', and no gate its seats announced to another rig is still called open' : ' (gates not checked: the hub did not answer)'}.`}
      </p>
    );
  }
  return (
    <div className="run-waiting" data-testid="run-waiting">
      {toDavid.length > 0 && (
        <ul aria-label="Open items to David">
          {toDavid.slice(0, SHOWN).map((q) => {
            const session = q.source && seats.has(q.source) ? q.source : null;
            const line = session && w !== 'loading' ? attachLine(session, got?.ssh ?? null) : null;
            return (
              <li key={q.id} data-testid="run-to-david" data-id={q.id}>
                <span>
                  {who(q.source)} → David: {(q.summary ?? q.id).split('\n')[0]}{' '}
                  <span className="run-from">
                    {clock(q.createdAt)} · {q.state}
                  </span>
                </span>
                {line ? (
                  <span className="run-act">
                    <span className="run-from">act here:</span>{' '}
                    <code data-testid="run-attach" id={`attach-${q.id}`}>
                      {line}
                    </code>
                    <Copy
                      text={line}
                      label={`the attach line for ${who(q.source)}`}
                      target={() => document.getElementById(`attach-${q.id}`)}
                    />
                    {!got?.ssh && (
                      <span className="run-from">
                        {' '}
                        {got
                          ? `(run it on ${label}; add machines.${machineId}.ssh to AppyRig config for a line that works from anywhere)`
                          : `(run it on ${label}; the hub did not answer, so the remote line is not shown)`}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="run-from">
                    act here:{' '}
                    {w === 'loading'
                      ? 'reading…'
                      : !session
                        ? `no attach line (${who(q.source)} is not a seat ${label} reports)`
                        : 'no attach line (the session name has characters a shell would read)'}
                  </span>
                )}
              </li>
            );
          })}
          {toDavid.length > SHOWN && (
            <li className="run-from">and {toDavid.length - SHOWN} older open items to David</li>
          )}
        </ul>
      )}
      {gates.length > 0 && (
        <ul aria-label="Open FliStudio gates">
          {gates.map((g) => (
            <li key={g.gate} data-testid="run-gate" data-gate={g.gate}>
              <span>
                FliStudio gate <code>{g.gate}</code>{' '}
                <span className="run-from">
                  said open by {who(g.from)} → {who(g.to)}, {clock(g.at)}: “{g.context}”
                </span>
              </span>
              <span className="run-act">
                <span className="run-from">act here:</span>{' '}
                {g.link ? (
                  <a href={g.link} target="_blank" rel="noreferrer" data-testid="run-gate-link">
                    Open the gate in FliStudio ↗
                  </a>
                ) : (
                  <span className="run-from">no link in the handoffs (open it from FliStudio)</span>
                )}
              </span>
            </li>
          ))}
          <li className="run-from">
            AppyRig reads only the handoffs, not FliStudio: a gate may since have been answered
            there.
          </li>
        </ul>
      )}
    </div>
  );
}
