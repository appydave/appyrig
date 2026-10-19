import { useEffect } from 'react';
import { seatName } from '../../fleet/model.js';
import type { AgentPanelTarget, V2Context } from '../types.js';

/**
 * v2 shell · the ONE slot the Agent panel is hosted in. The panel (kit/AgentPanel, from the panel
 * lane) renders inside it; until that lands, `InterimPanel` stands in so the contract can be walked.
 *
 * The slot is a right-hand column that starts below the top bar (it never covers the nav). The panel
 * component gets: the context, what it is open on, close, and "open the full Agent page".
 */
export interface AgentPanelHostProps {
  ctx: V2Context;
  target: AgentPanelTarget;
  onClose: () => void;
  onOpenFullPage: () => void;
}

/** Swap this for the kit's AgentPanel when the panel lane lands (same props). */
function InterimPanel({ ctx, target, onClose, onOpenFullPage }: AgentPanelHostProps) {
  const fm = ctx.allMachines.find((m) => m.machine.id === target.machineId);
  const seatId = target.seatKey.slice(target.seatKey.indexOf('/') + 1);
  const seat = fm?.snapshot.seats.find((s) => s.id === seatId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="agent-panel-interim" data-testid="agent-panel" data-tab={target.tab}>
      <header>
        <b>{seat ? seatName(seat) : seatId}</b>
        <span className="quiet"> · {fm?.machine.label ?? target.machineId}</span>
        <button
          type="button"
          className="pill-btn"
          data-testid="agent-panel-close"
          aria-label="Close the agent panel"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p className="quiet">{seat ? seat.id : 'This agent is not reported right now.'}</p>
      <button
        type="button"
        className="pill-btn"
        data-testid="agent-panel-full"
        onClick={onOpenFullPage}
      >
        Open full agent page →
      </button>
    </div>
  );
}

export default function AgentPanelSlot({ ctx }: { ctx: V2Context }) {
  const target = ctx.agentPanel;
  if (!target) return null;
  return (
    <aside className="agent-panel-slot" data-testid="agent-panel-slot" aria-label="Agent panel">
      <InterimPanel
        ctx={ctx}
        target={target}
        onClose={ctx.closeAgentPanel}
        onOpenFullPage={() => ctx.openAgentPage(target.seatKey)}
      />
    </aside>
  );
}
