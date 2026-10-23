import { useEffect, useMemo, useState } from 'react';
import type { QueueItem } from '@appydave/shared';
import type { PageDef, PageProps } from '@client/app/types.js';
import { buildRigMap } from '@client/domain/fleet/views/map/rigMap.js';
import { PageHeader, useDocsDrawer } from '@client/kit/index.js';
import { allGroups, buildGraph } from '@client/domain/graph/model.js';
import { lastWords } from '@client/pages/graph/RigBox.js';
import RigInside from '@client/pages/graph/RigInside.js';
import { RIG_STATE } from '@client/domain/fleet/views/core/rigState.js';
import { freshness } from '@client/domain/fleet/model.js';
import '@client/pages/graph/graph.css';
import './rigmap.css';

interface Pinned {
  title: string;
  items: QueueItem[];
}

/**
 * The Rig Map: ONE rig, the one picked in the Rigs drawer, across the full page width. It is the
 * Graph's open-rig inside (pods, compact cards, handoff lines, the person card) with room, so
 * nothing here is forked: it renders the same RigInside. The cards are the Wall's (V1 body); the Graph keeps its compact ones.
 */
function RigMapPage({ ctx }: PageProps) {
  const rigKey = ctx.activeRig?.key ?? null;
  const minute = Math.floor(ctx.now / 60_000) * 60_000;
  const graph = useMemo(() => buildGraph(ctx.allMachines, minute), [ctx.allMachines, minute]);
  const rig = useMemo(
    () => (rigKey ? (allGroups(graph).find((g) => g.key === rigKey) ?? null) : null),
    [graph, rigKey]
  );
  const map = useMemo(
    () => (rig && rig.ref ? buildRigMap(ctx.allMachines, rig.key, minute) : null),
    [ctx.allMachines, rig, minute]
  );
  const { openDocs, drawer: docsDrawer } = useDocsDrawer(ctx);
  const [pinned, setPinned] = useState<Pinned | null>(null);

  useEffect(() => {
    if (!pinned) {
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return;
      }

      e.preventDefault();
      setPinned(null);
    };

    window.addEventListener('keydown', onKey, true);

    return () => window.removeEventListener('keydown', onKey, true);
  }, [pinned]);

  const openAgent = (key: string) =>
    ctx.openAgentPanel({ machineId: key.slice(0, key.indexOf('/')), seatKey: key });
  const openSeatDocs = (key: string) =>
    ctx.openAgentPanel({
      machineId: key.slice(0, key.indexOf('/')),
      seatKey: key,
      tab: 'documents',
    });

  if (!rig || !map) {
    return (
      <main className="ar-rigmap" data-testid="ar-rigmap" data-empty>
        <PageHeader title="Rig Map" facts={[]} />
        <p className="empty" data-testid="rm-empty">
          Pick a rig on the left.
        </p>
      </main>
    );
  }

  const st = RIG_STATE[rig.state];

  return (
    <main className="ar-rigmap" data-testid="ar-rigmap" data-state={rig.state}>
      <PageHeader
        title="Rig Map"
        facts={[
          `${rig.name} on ${rig.machineLabel}`,
          `${st.label}`,
          `${rig.agents} agent${rig.agents === 1 ? '' : 's'}`,
        ]}
      />
      <div className="rm-body" data-testid="rm-body" data-rig-key={rig.key} data-state={rig.state}>
        <RigInside
          map={map}
          rig={rig}
          socket={ctx.getSocket()}
          machines={ctx.allMachines}
          lastWords={lastWords(rig, ctx.now)}
          onOpenAgent={openAgent}
          onDetails={() => openDocs({ machineId: rig.machineId, rig: rig.name })}
          onDocs={openSeatDocs}
          onPin={(title, items) => setPinned({ title, items })}
          roomy={{ fresh: (m) => freshness(m, ctx.now, ctx.hubConnected).label }}
        />
      </div>
      {pinned && (
        <aside className="g2-drawer" data-testid="g2-drawer" aria-label={pinned.title}>
          <header>
            <b>{pinned.title}</b>
            <button type="button" className="pill-btn" onClick={() => setPinned(null)}>
              Close · Esc
            </button>
          </header>
          <ol className="g2-items">
            {[...pinned.items]
              .reverse()
              .slice(0, 40)
              .map((q) => (
                <li key={q.id} data-testid="g2-drawer-item" data-state={q.state}>
                  <span className="mono">
                    {q.source} → {q.destination}
                  </span>{' '}
                  <span className="g2-item-state">{q.state}</span>
                  <span className="g2-item-summary">{q.summary ?? q.id}</span>
                </li>
              ))}
          </ol>
        </aside>
      )}
      {docsDrawer}
    </main>
  );
}

export const page: PageDef = {
  key: 'map',
  label: 'Rig Map',
  group: 'work',
  component: RigMapPage,
  blurb: 'One rig, full width: pods, agent cards, handoff lines and the people.',
};
