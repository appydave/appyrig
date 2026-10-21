import {
  MISSION_STORE_MAX_BYTES,
  type MissionFileOutput,
  type MissionFilePush,
  type MissionFilesPush,
} from '@appydave/shared';

/**
 * Run board, lane 1: the mission files each collector pushed, in memory only. A hub restart forgets
 * them and every collector sends them again on reconnecting. The hub never reads a disk for these.
 *
 * The collector's list (the manifest) is the whole allowlist: a path that is not on it is `refused`
 * here without looking at anything else, and a file can only be stored if its path is on the list.
 */

interface Held {
  status: 'ok' | 'missing' | 'too_large';
  mime: string | null;
  bytes: number | null;
  modifiedAt: string | null;
  text: string | null;
  base64: string | null;
}

interface Partial_ {
  parts: number;
  next: number;
  chunks: string[];
  head: MissionFilePush;
}

const empty = (machine: string, rig: string, path: string) => ({
  machine,
  rig,
  path,
  mime: null,
  bytes: null,
  modifiedAt: null,
  text: null,
  base64: null,
});

export class MissionFileStore {
  private readonly lists = new Map<string, Set<string>>();
  private readonly files = new Map<string, Map<string, Held>>();
  private readonly partial = new Map<string, Partial_>();

  private key(machine: string, rig: string): string {
    return `${machine}\u0000${rig}`;
  }

  put(push: MissionFilesPush): void {
    const k = this.key(push.machineId, push.rig);
    if (push.kind === 'manifest') {
      const list = new Set(push.paths);
      this.lists.set(k, list);
      const held = this.files.get(k);
      if (held) {
        for (const p of [...held.keys()]) {
          if (!list.has(p)) {
            held.delete(p);
          }
        }
      }

      return;
    }
    // A file for a path the collector did not list is ignored: the list is the allowlist.
    if (!this.lists.get(k)?.has(push.path)) {
      return;
    }
    const held = this.files.get(k) ?? new Map<string, Held>();
    this.files.set(k, held);
    const pk = `${k}\u0000${push.path}`;
    if (push.status !== 'ok') {
      held.delete(push.path);
      held.set(push.path, {
        status: push.status,
        mime: push.mime ?? null,
        bytes: push.bytes ?? null,
        modifiedAt: push.modifiedAt ?? null,
        text: null,
        base64: null,
      });
      this.partial.delete(pk);

      return;
    }
    let chunk: string;
    if (push.text !== undefined) {
      chunk = push.text;
    } else {
      chunk = push.base64 ?? '';
    }
    if (push.part === 0) {
      this.partial.set(pk, { parts: push.parts, next: 0, chunks: [], head: push });
    }
    const p = this.partial.get(pk);
    if (!p || p.next !== push.part || p.parts !== push.parts) {
      this.partial.delete(pk); // out of order: drop it, the collector re-sends on its next change

      return;
    }
    p.chunks.push(chunk);
    p.next += 1;
    if (p.next < p.parts) {
      return;
    }
    this.partial.delete(pk);
    const joined = p.chunks.join('');
    held.delete(push.path); // re-insert at the end: newest arrival
    held.set(push.path, {
      status: 'ok',
      mime: p.head.mime ?? null,
      bytes: p.head.bytes ?? null,
      modifiedAt: p.head.modifiedAt ?? null,
      text: p.head.text !== undefined ? joined : null,
      base64: p.head.text === undefined ? joined : null,
    });
    let total = 0;
    for (const h of held.values()) {
      total += (h.text?.length ?? 0) + (h.base64?.length ?? 0);
    }
    for (const path of held.keys()) {
      if (total <= MISSION_STORE_MAX_BYTES) {
        break;
      }
      const h = held.get(path)!;
      total -= (h.text?.length ?? 0) + (h.base64?.length ?? 0);
      held.delete(path);
    }
  }

  /** Paths this rig may serve, or undefined when this machine has sent no list for it. */
  list(machine: string, rig: string): string[] | undefined {
    const l = this.lists.get(this.key(machine, rig));

    return l ? [...l] : undefined;
  }

  get(machine: string, rig: string, path: string): MissionFileOutput {
    const k = this.key(machine, rig);
    const list = this.lists.get(k);
    if (!list) {
      return { ...empty(machine, rig, path), status: 'no-data' };
    }
    let real = path;
    if (!path.startsWith('/')) {
      // Rig-relative form: only qa/<name> and shots/<name>, matched against the pushed list. A name
      // the collector did not list is a file not written yet; anything else is not a name at all.
      if (!/^(qa|shots)\/[^/\0]+$/.test(path) || path.includes('..')) {
        return { ...empty(machine, rig, path), status: 'refused' };
      }
      const hit = [...list].find((p) => p.endsWith(`/${path}`));
      if (!hit) {
        return { ...empty(machine, rig, path), status: 'missing' };
      }
      real = hit;
    }
    if (!list.has(real)) {
      return { ...empty(machine, rig, path), status: 'refused' };
    }
    const h = this.files.get(k)?.get(real);
    if (!h) {
      return { ...empty(machine, rig, path), status: 'pending' };
    }

    return {
      machine,
      rig,
      path,
      status: h.status,
      mime: h.mime,
      bytes: h.bytes,
      modifiedAt: h.modifiedAt,
      text: h.text,
      base64: h.base64,
    };
  }
}
