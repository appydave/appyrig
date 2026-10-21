import { FakeControl, SampleData, realNames } from '../../kit/index.js';
import { NAV_GROUPS, navLabel, pageFor } from '../../app/registry.js';
import type { PageDef, PageProps } from '../../app/types.js';

/**
 * W0 demo of a page that exists only in v2: what v2 is, how to move around it, and what is still
 * to come. Uses the kit (one FakeControl, one SampleData section) so later waves have an example.
 */
function AboutPage({ ctx }: PageProps) {
  const names = realNames(ctx.allMachines);
  const rig = names.rigs[0];
  const seats = names.seats.slice(0, 3);
  return (
    <main className="view ar-about" data-testid="ar-about">
      <h2>About v2</h2>
      <p>
        v2 is the redesign of AppyRig, built inside the real app on the same data. <kbd>V</kbd>{' '}
        switches the whole app between <b>Current</b> and <b>v2</b>; <kbd>B</kbd> flips just this
        page between old and new, keeping the rig, the selection and the scroll. This page is new in
        v2, so it has no old version.
      </p>
      <h3>Where things are</h3>
      <ul className="ar-about-groups">
        {NAV_GROUPS.map((g) => (
          <li key={g.key}>
            <b>{g.label}:</b>{' '}
            {g.pages.map((p, i) => (
              <span key={p}>
                {i > 0 && ' · '}
                <span>
                  {navLabel(p)}
                  {pageFor(p) ? ' (v2)' : ''}
                </span>
              </span>
            ))}
          </li>
        ))}
      </ul>
      <h3>The v2 kit</h3>
      <p>
        A control AppyRig does not have yet is shown as a mock: it walks through confirm, progress
        and result, and changes nothing.
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
  label: 'About v2',
  group: 'hood',
  component: AboutPage,
  blurb: 'What v2 is, its keys, and what is still to come.',
};
