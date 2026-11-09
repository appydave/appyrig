import type {
  AppConfig,
  FleetMachine,
  QueueItem,
  RigGate,
  RigWaitingOutput,
} from '@appydave/shared';

/** What reading a handoff needs from the hub's FleetStore (which satisfies it): a body by id. */
interface HandoffSource {
  getHandoff(machineId: string, id: string): { body: string } | undefined;
}

/** What `rigWaiting` reads from the verb context: the handoffs and AppyRig's own config. */
interface RigSources {
  store: HandoffSource;
  config?: () => AppConfig;
}

/**
 * What the rig run cards read out of a rig's handoffs: the gates a rig is waiting on David for
 * (`rig.waiting`) and the handoff list both run-card verbs start from. Pure reading of the hub's
 * FleetStore; the verb handlers in verbs.ts call in.
 */

const GATE = /\bg_[0-9a-f]{10}\b/g;
const SAYS_OPEN = /\bopen(ed)?\b|\bwaiting\b|\bawaits?\b/i;
const SAYS_SHUT =
  /\b(closed|approved|answered|passed|accepted|resolved|rejected|done with|shipped|cleared|leave it)\b|\bdo not (poll|wait)|\bdon'?t (poll|wait)/i;

type Mention = { open: boolean; shut: boolean; context: string };
type Verdict = { gate: RigGate; open: boolean };

/** Is this address one of the rig's seats? David's mailbox is no rig. */
function inRigOf(m: FleetMachine, rig: string): (raw: string | null) => boolean {
  const seatRig = new Map(m.snapshot.seats.map((s) => [s.id, s.rig]));

  return (raw) =>
    !!raw && raw.split('@')[0] !== 'human' && (seatRig.get(raw) ?? raw.split('@')[1]) === rig;
}

/** A handoff's summary and body as one text; `missing` when the hub never received the body. */
export function handoffText(
  store: HandoffSource,
  machineId: string,
  q: QueueItem
): { text: string; missing: boolean } {
  const body = store.getHandoff(machineId, q.id)?.body ?? null;

  return { text: `${q.summary ?? ''}\n${body ?? ''}`, missing: body === null };
}

/** The words of `text` from one place to another, with whitespace squeezed to single spaces. */
export function around(text: string, from: number, to: number): string {
  return text.slice(Math.max(0, from), to).replace(/\s+/g, ' ');
}

/** Of the links a handoff carried, a Tailscale address before localhost. */
export function bestLink(urls: string[] = []): string | null {
  return urls.find((u) => !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) ?? urls[0] ?? null;
}

/** QA R2 MEDIUM-2: a gate is the rig's when one of its seats announces it to another rig's seat
 * (ylo-lead → the desk). Handoffs inside the rig, or reports to David's mailbox, often quote other
 * rigs' gates; they may close a gate but never open one. */
function announces(q: QueueItem, inRig: (raw: string | null) => boolean): boolean {
  return (
    inRig(q.source) && !inRig(q.destination) && (q.destination ?? '').split('@')[0] !== 'human'
  );
}

/** Remembers every link to a gate that `text` carries, by gate id. */
function collectLinks(text: string, links: Map<string, string[]>): void {
  for (const url of text.match(/https?:\/\/[^\s"'<>)\]]*gate=g_[0-9a-f]{10}[^\s"'<>)\]]*/g) ?? []) {
    const id = /gate=(g_[0-9a-f]{10})/.exec(url)![1]!;

    // Stored bodies can hold a literal backslash-n right after a link ("…#packaging\\n(on").
    links.set(id, [...(links.get(id) ?? []), url.replace(/\\n.*$/, '')]);
  }
}

/** Folds one mention of a gate into what its handoff has said about that gate so far. */
function readMention(here: Map<string, Mention>, text: string, hit: RegExpMatchArray): void {
  const at = hit.index ?? 0;
  const near = around(text, at - 60, at + 70).trim();
  const h = here.get(hit[0]) ?? { open: false, shut: false, context: near };

  if (SAYS_OPEN.test(near) && !h.open) {
    Object.assign(h, { open: true, context: near });
  }

  // r1 R2 LOW-1: a closing word must sit close to the id ("g_… approved", "gate g_… leave
  // it"), so "gate g_… OPEN: rule check PASSED" still reads open.
  if (SAYS_SHUT.test(around(text, at - 30, at + 42))) {
    h.shut = true;
  }

  here.set(hit[0], h);
}

/** One handoff decides as a whole: open when some mention in it reads open and none reads
 * closed (a gate is often named twice, once in words and once inside its link). */
function mentionsIn(text: string): Map<string, Mention> {
  const here = new Map<string, Mention>();

  for (const hit of text.matchAll(GATE)) {
    readMention(here, text, hit);
  }

  return here;
}

/** What one handoff says about each gate it settles. A mention that says neither (a list of ids,
 * a link alone) leaves the gate as it was. */
function verdicts(q: QueueItem, text: string, announced: boolean): [string, Verdict][] {
  return [...mentionsIn(text)]
    .filter(([, h]) => (h.open && announced) || h.shut)
    .map(([gate, h]): [string, Verdict] => [
      gate,
      {
        open: h.open && announced && !h.shut,
        gate: {
          gate,
          itemId: q.id,
          at: q.createdAt,
          from: q.source,
          to: q.destination,
          context: h.context,
          link: null,
        },
      },
    ]);
}

/** The gates still open, newest first, each with the link its handoffs carried. */
function openGates(newest: Map<string, Verdict>, links: Map<string, string[]>): RigGate[] {
  return [...newest.values()]
    .filter((g) => g.open)
    .map((g) => ({ ...g.gate, link: bestLink(links.get(g.gate.gate)) }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Run card R2: the gates a rig's handoffs last called open, and the machine's ssh address. A
 * gate's newest mention that SAYS something decides: open words near it ("gate g_… open",
 * "waiting at …") keep it, any closing word ("approved", "leave it", "do not wait") drops it; a
 * bare mention (a list of ids, a link alone) changes nothing, and a gate never called open is not
 * listed. Only a handoff a rig seat sends to another rig's seat can open one (QA R2 MEDIUM-2).
 * Links are only ones a handoff carried, a Tailscale address before localhost.
 */
export function rigWaiting(m: FleetMachine, rig: string, src: RigSources): RigWaitingOutput {
  const inRig = inRigOf(m, rig);
  const items = rigItems(m, rig);
  const newest = new Map<string, Verdict>();
  const links = new Map<string, string[]>();
  let bodiesMissing = 0;

  for (const q of items) {
    const { text, missing } = handoffText(src.store, m.machine.id, q);

    if (missing) {
      bodiesMissing += 1;
    }

    collectLinks(text, links);

    for (const [gate, verdict] of verdicts(q, text, announces(q, inRig))) {
      newest.set(gate, verdict);
    }
  }

  return {
    machine: m.machine.id,
    rig,
    ssh: (src.config?.() ?? {}).machines?.[m.machine.id]?.ssh ?? null,
    gates: openGates(newest, links),
    scanned: items.length,
    bodiesMissing,
  };
}

/** The rig's handoffs (either end in the rig; David's mailbox is no rig), oldest first. */
export function rigItems(m: FleetMachine, rig: string) {
  const inRig = inRigOf(m, rig);

  return m.snapshot.queue
    .filter((q) => inRig(q.source) || inRig(q.destination))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
