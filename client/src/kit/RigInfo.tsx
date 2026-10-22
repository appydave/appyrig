import type { RigRef } from '@client/domain/fleet/views.js';

export type RigFacts = Pick<
  RigRef,
  'name' | 'displayName' | 'owner' | 'summary' | 'specPath' | 'specStatus'
>;

/**
 * S3: what AppyRig knows about a rig, in words, saying honestly when it doesn't know. Each field
 * is optional on the wire: absent means the hub or collector did not say, not "none".
 */
export function rigFacts(r: RigFacts): { summary: string; owner: string; spec: string } {
  return {
    summary:
      r.summary ??
      (r.specStatus === 'found'
        ? 'No summary: line in its rig.yaml.'
        : r.specStatus === 'not-found'
          ? 'No summary: rig.yaml not found.'
          : 'No summary reported.'),
    owner: r.owner ?? 'No owner set in AppyRig config.',
    spec:
      r.specStatus === 'found'
        ? (r.specPath ?? 'found (path not reported)')
        : r.specStatus === 'not-found'
          ? 'Spec not found in the configured spec folders.'
          : "Not reported: this machine's collector does not look for rig.yaml yet.",
  };
}

/** One line for a hover title: name, summary, owner and spec path. */
export function rigTitle(r: RigFacts): string {
  const f = rigFacts(r);
  const name = r.displayName && r.displayName !== r.name ? `${r.displayName} (${r.name})` : r.name;

  return `${name}\n${f.summary}\nOwner: ${f.owner}\nSpec: ${f.spec}`;
}

interface Props {
  rig: RigRef;
  /** True while a chip is hovered or focused, false when it is the selected rig. */
  preview: boolean;
  /** S7-ui: open this rig's files (rig.yaml, mission and culture notes). */
  onOpenFiles?: (rig: RigRef) => void;
}

/** S3: the panel under the rig chips: summary, owner and spec path of the hovered or chosen rig. */
export default function RigInfo({ rig, preview, onOpenFiles }: Props) {
  const f = rigFacts(rig);

  return (
    <section
      className="rig-info"
      data-testid="rig-info"
      data-rig-key={rig.key}
      data-preview={preview}
      aria-live="polite"
    >
      <header>
        <b>{rig.displayName ?? rig.name}</b>
        {rig.displayName && rig.displayName !== rig.name && (
          <code data-testid="rig-info-id">{rig.name}</code>
        )}
        <span className="label">
          {rig.machineLabel} · {rig.status}
        </span>
        {onOpenFiles && (
          <button
            type="button"
            className="pill-btn"
            data-testid="rig-files-open"
            aria-keyshortcuts="O"
            title="Open this rig's files: rig.yaml, mission and culture notes (O)"
            onClick={() => onOpenFiles(rig)}
          >
            Files · O
          </button>
        )}
      </header>
      <p data-testid="rig-info-summary">{f.summary}</p>
      <dl>
        <dt>Owner</dt>
        <dd data-testid="rig-info-owner">{f.owner}</dd>
        <dt>Spec</dt>
        <dd data-testid="rig-info-spec" data-status={rig.specStatus ?? 'unreported'}>
          {rig.specStatus === 'found' ? <code>{f.spec}</code> : f.spec}
        </dd>
      </dl>
    </section>
  );
}
