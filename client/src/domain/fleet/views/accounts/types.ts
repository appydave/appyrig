import { type AccountDerived, type AccountUsage } from '@appydave/shared';

interface AccountDrawer {
  machineLabel: string;
  seats: string[];
}

export interface AccountView {
  email: string;
  planLabel: string;
  /** The freshest reading across this account's machines, if any machine has a sampler. */
  /** `push`: the collectedAt and hub receive time of the push it came in, for its age (F3). */
  reading:
    | (AccountUsage & {
        from: string;
        push: { collectedAt: string; receivedAt: string };
        /** F4: the reading's machine has stopped reporting. */
        asleep: boolean;
      })
    | null;
  machines: string[];
  drawers: AccountDrawer[];
  /** Live, non-stopped Claude seats on the machines whose cached profile names it (their login is not read). */
  activeSeats: number;
  /** S5: the hub's view of the account (tier, windows against their resets); null from an older hub. */
  derived: AccountDerived | null;
  /**
   * v1.5 · C: per machine on this card, when its cached profile (where the email comes from) was
   * fetched. null = not in the cache; undefined = an older collector does not report it.
   */
  profiles: { machine: string; fetchedAt: string | null | undefined }[];
}

/**
 * Accounts across the fleet, grouped by each machine's CACHED profile (v1.5 C), which is not
 * proof of the login its seats use. The seats listed are those running on those machines. Readings come only from machines with a sampler; the
 * freshest one wins, because every machine on the account sees the same window.
 */
export interface UnreportedMachine {
  label: string;
  /** `old-collector`: the snapshot has no account field at all. `no-login`: it says no Claude login. */
  reason: 'old-collector' | 'no-login';
}
