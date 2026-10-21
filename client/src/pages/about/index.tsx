import { FakeControl, SampleData, realNames } from '../../kit/index.js';
import { NAV_GROUPS, navLabel } from '../../app/registry.js';
import type { PageDef, PageProps } from '../../app/types.js';

/**
 * The About page: what AppyRig is, where things are, and what is real versus a mock. Uses the kit (one FakeControl, one SampleData section) so later waves have an example.
 */
function AboutPage({ ctx }: PageProps) {
  const names = realNames(ctx.allMachines);
  const rig = names.rigs[0];
  const seats = names.seats.slice(0, 3);
  return (
    <main className="view ar-about" data-testid="ar-about">
      <h2>About</h2>
      <p>
        AppyRig is a read-only view of David&rsquo;s OpenRig fleet across the M2, the M4 and Roamy:
        the rigs, the seats and what they are doing. It reads the hub&rsquo;s collected data and
        never changes a rig. The screens of the old V1 are kept in <b>⋯ → V1 archive</b>.
      </p>
      <h3>Where things are</h3>
      <ul className="ar-about-groups">
        {NAV_GROUPS.map((g) => (
          <li key={g.key}>
            <b>{g.label}:</b>{' '}
            {g.pages.map((p, i) => (
              <span key={p}>
                {i > 0 && ' · '}
                <span>{navLabel(p)}</span>
              </span>
            ))}
          </li>
        ))}
      </ul>
      <h3>What is real, what is a mock</h3>
      <p>
        Everything you read is real. A control AppyRig does not have yet is shown as a mock: it
        walks through confirm, progress and result, and changes nothing.
      </p>
      <p>
        <FakeControl
          label={rig ? `Restore ${rig.name}` : 'Restore rig'}
          question={rig ? `Restore ${rig.name} on ${rig.machine}?` : 'Restore this rig?'}
          result={rig ? `${rig.name} restored (pretend)` : 'Restored (pretend)'}
        />
      </p>
      <SampleData
        title="Waiting on you"
        what="The seats are real; what they are waiting for is made up, to show the shape of the Needs You page."
      >
        {seats.length === 0 ? (
          <p className="quiet">No seats in this fleet to borrow names from.</p>
        ) : (
          <ul>
            {seats.map((s, i) => (
              <li key={`${s.machine}/${s.id}`}>
                <code>{s.id}</code> on {s.machine}:{' '}
                {
                  [
                    'asks to approve a file read',
                    'waits for your go on a merge',
                    'asks a question',
                  ][i % 3]
                }
              </li>
            ))}
          </ul>
        )}
      </SampleData>
    </main>
  );
}

export const page: PageDef = {
  key: 'about',
  label: 'About',
  group: 'hood',
  component: AboutPage,
  blurb: 'What AppyRig is, where things are, what is real and what is still a mock.',
};
