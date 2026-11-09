import { compareTimes } from '@appydave/shared';
/** What the rig run cards read from a rig's handoffs: open gates (`rig.waiting`), commits and
 * FliStudio ids (`rig.outputs`). Pure reading of the FleetStore; the verb handlers call in. */

import type {
  AppConfig,
  FleetMachine,
  QueueItem,
  RigGate,
  RigOutputsOutput,
  RigWaitingOutput,
} from '@appydave/shared';

/** What reading a handoff needs from the hub's FleetStore (which satisfies it): a body by id. */
type HandoffSource = { getHandoff(machineId: string, id: string): { body: string } | undefined };

/** What `rigWaiting` and `rigOutputs` read from the verb context: the handoffs and AppyRig's own config. */
interface RigSources {
  store: HandoffSource;
  config?: () => AppConfig;
}

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
function handoffText(
  store: HandoffSource,
  machineId: string,
  q: QueueItem
): { text: string; missing: boolean } {
  const body = store.getHandoff(machineId, q.id)?.body ?? null;

  return { text: `${q.summary ?? ''}\n${body ?? ''}`, missing: body === null };
}

/** The words of `text` from one place to another, with whitespace squeezed to single spaces. */
function around(text: string, from: number, to: number): string {
  return text.slice(Math.max(0, from), to).replace(/\s+/g, ' ');
}

/** Of the links a handoff carried, a Tailscale address before localhost. */
function bestLink(urls: string[] = []): string | null {
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
    .sort((a, b) => compareTimes(b.at, a.at));
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
function rigItems(m: FleetMachine, rig: string) {
  const inRig = inRigOf(m, rig);

  return m.snapshot.queue
    .filter((q) => inRig(q.source) || inRig(q.destination))
    .sort((a, b) => compareTimes(a.createdAt, b.createdAt));
}

const SHA = /(?<![\w/.-])([0-9a-f]{7,10})(?![\w-])/g;
const FLI_ID = /(?<![\w-])([rg]_[0-9a-f]{10})(?![\w-])/g;

type Named = {
  itemId: string;
  at: string;
  from: string | null;
  to: string | null;
  context: string;
  mentions: number;
};
type Noter = (map: Map<string, Named>, key: string, at: number) => void;

/** Notes a key as named by this handoff: once per handoff, counting the handoffs that name it. */
function noterFor(q: QueueItem, text: string): Noter {
  const seen = new Set<string>();

  return (map, key, at) => {
    if (seen.has(key)) {
      return;
    }

    seen.add(key);

    const prev = map.get(key);

    map.set(key, {
      ...(prev ?? {}),
      itemId: q.id,
      at: q.createdAt,
      from: q.source,
      to: q.destination,
      context: around(text, at - 50, at + 60).trim(),
      mentions: (prev?.mentions ?? 0) + 1,
    } as Named);
  };
}

function noteCommits(text: string, note: Noter, commits: Map<string, Named>): void {
  for (const hit of text.matchAll(SHA)) {
    const sha = hit[1]!;

    if (/\d/.test(sha) && /[a-f]/.test(sha)) {
      note(commits, sha, hit.index ?? 0);
    }
  }
}

function noteFli(
  text: string,
  note: Noter,
  fli: Map<string, Named & { link: string | null }>
): void {
  for (const hit of text.matchAll(FLI_ID)) {
    const id = hit[1]!;

    note(fli as Map<string, Named>, id, hit.index ?? 0);

    const url = text.match(
      new RegExp(`https?:\\/\\/[^\\s"'<>)\\]]*(?:gate|resource)=${id}[^\\s"'<>)\\]]*`, 'g')
    );
    const f = fli.get(id)!;
    const pick = bestLink(url ?? []);

    if (pick) {
      f.link = pick.replace(/\\n.*$/, '');
    } else {
      f.link ??= null;
    }
  }
}

/** Newest first; in one handoff, the most-named first. */
function newestFirst<T extends { at: string; mentions: number }>(xs: T[]): T[] {
  return xs.sort((a, b) => compareTimes(b.at, a.at) || b.mentions - a.mentions);
}

/** Run card R4: commits and FliStudio ids named in the rig's handoffs (see 'rig.outputs'). */
export function rigOutputs(m: FleetMachine, rig: string, src: RigSources): RigOutputsOutput {
  const items = rigItems(m, rig);
  const commits = new Map<string, Named>();
  const fli = new Map<string, Named & { link: string | null }>();
  let bodiesMissing = 0;

  for (const q of items) {
    const { text, missing } = handoffText(src.store, m.machine.id, q);

    if (missing) {
      bodiesMissing += 1;
    }

    const note = noterFor(q, text);

    noteCommits(text, note, commits);
    noteFli(text, note, fli);
  }

  return {
    machine: m.machine.id,
    rig,
    commits: newestFirst([...commits].map(([sha, n]) => ({ sha, ...n }))).slice(0, 20),
    flistudio: newestFirst(
      [...fli].map(([id, n]) => ({
        id,
        kind: id.startsWith('g_') ? ('gate' as const) : ('resource' as const),
        ...n,
        link: n.link ?? null,
      }))
    ).slice(0, 40),
    scanned: items.length,
    bodiesMissing,
  };
}
