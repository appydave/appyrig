import { sampleAge, type FleetMachine, type Seat } from '@appydave/shared';
import {
  STALE_READING_MS,
  windowStory,
  type VerdictKind,
} from '@client/domain/fleet/accountWindow.js';
import { seatName } from '@client/domain/fleet/model.js';
import {
  type AccountView,
  type UnreportedMachine,
} from '@client/domain/fleet/views/accounts/types.js';

const PLAN_LABEL: Record<string, string> = {
  claude_max: 'Max · tier not reported',
  claude_pro: 'Pro',
  claude_team: 'Team',
  claude_enterprise: 'Enterprise',
};

function planLabel(plan: string | null): string {
  if (!plan) {
    return 'plan unknown';
  }

  return PLAN_LABEL[plan] ?? plan;
}

const isClaudeSeat = (s: Seat) => s.runtime === 'claude-code' || /^claude-/.test(s.model ?? '');

type MachineAccount = NonNullable<FleetMachine['snapshot']['account']>;

export function buildAccounts(machines: FleetMachine[]): {
  accounts: AccountView[];
  unknown: UnreportedMachine[];
} {
  const accounts = new Map<string, AccountView>();
  const unknown: UnreportedMachine[] = [];

  for (const fm of machines) {
    const acct = fm.snapshot.account;

    if (!acct?.email) {
      unknown.push({
        label: fm.machine.label,
        reason: acct === undefined ? 'old-collector' : 'no-login',
      });
      continue;
    }

    const v = accounts.get(acct.email) ?? newAccountView(acct.email, acct);

    takeDerived(v, acct);
    v.machines.push(fm.machine.label);
    v.profiles.push({ machine: fm.machine.label, fetchedAt: acct.profileFetchedAt });
    takeReading(v, fm, acct);
    addSeats(v, fm);
    accounts.set(acct.email, v);
  }

  return {
    accounts: [...accounts.values()].sort((a, b) => a.email.localeCompare(b.email)),
    unknown,
  };
}

function newAccountView(email: string, acct: MachineAccount): AccountView {
  return {
    email,
    planLabel: planLabel(acct.plan),
    reading: null,
    machines: [],
    drawers: [],
    activeSeats: 0,
    derived: null,
    profiles: [],
  };
}

/** The hub derives one answer per account; take the one with a reading if machines differ. */
function takeDerived(v: AccountView, acct: MachineAccount): void {
  const next = acct.derived;

  if (next && (!v.derived || (!v.derived.readingFrom && next.readingFrom))) {
    v.derived = next;
  }
}

/** The freshest reading wins: every machine on the account sees the same window. */
function takeReading(v: AccountView, fm: FleetMachine, acct: MachineAccount): void {
  if (acct.sampledAt && (!v.reading || acct.sampledAt > (v.reading.sampledAt ?? ''))) {
    v.reading = {
      ...acct,
      from: fm.machine.label,
      push: { collectedAt: fm.snapshot.collectedAt, receivedAt: fm.lastSeen },
      asleep: fm.liveness === 'asleep',
    };
  }
}

/** A live machine's non-stopped Claude seats count as active on the account. */
function addSeats(v: AccountView, fm: FleetMachine): void {
  const seats =
    fm.liveness === 'live'
      ? fm.snapshot.seats.filter((s) => s.status !== 'stopped' && isClaudeSeat(s))
      : [];

  if (seats.length) {
    v.drawers.push({ machineLabel: fm.machine.label, seats: seats.map(seatName) });
    v.activeSeats += seats.length;
  }
}

/** D0: how badly a window's verdict warns: 2 = will run out or spent, 1 = be careful, 0 = otherwise. */
const WARNS: Partial<Record<VerdictKind, number>> = { spent: 2, 'runs-out': 2, careful: 1 };

/**
 * The account with the most room among those with a reading; null if none can be compared.
 * D0 (usability T4-3): both windows count. An account whose 5-hour OR weekly verdict warns loses to
 * one where neither does; then the least-used window decides (the tighter of the two, not 5-hour only).
 * F4: a current reading always beats a stale one.
 */
export function mostHeadroom(
  accounts: AccountView[],
  now: number = Date.now()
): AccountView | null {
  const read = accounts.filter((a) => a.reading?.fiveHourPct != null);

  if (!read.length) {
    return null;
  }

  const warns = (a: AccountView) =>
    a.derived
      ? Math.max(
          WARNS[windowStory(a.derived.fiveHour, now).kind] ?? 0,
          WARNS[windowStory(a.derived.sevenDay, now).kind] ?? 0
        )
      : 0;
  const tightest = (a: AccountView) =>
    Math.max(a.reading!.fiveHourPct!, a.reading!.sevenDayPct ?? 0);
  // F4 (r1 LOW-1): a reading that is not current (its machine asleep, or past the old-reading
  // cut-off; the card below is dimmed) ranks after every current one.
  const stale = (a: AccountView) => {
    const r = a.reading!;

    if (r.asleep) {
      return 1;
    }

    return r.sampledAt && sampleAge(r.sampledAt, r.push, now).ageMs > STALE_READING_MS ? 1 : 0;
  };

  return read.sort(
    (a, b) =>
      stale(a) - stale(b) ||
      warns(a) - warns(b) ||
      tightest(a) - tightest(b) ||
      a.reading!.fiveHourPct! - b.reading!.fiveHourPct!
  )[0]!;
}
