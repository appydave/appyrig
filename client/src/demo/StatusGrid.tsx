import { useServerStatus } from '../hooks/useServerStatus.js';
import { useSocket } from '../hooks/useSocket.js';

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block w-3 h-3 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
  );
}

function StatusCard({
  title,
  ok,
  children,
}: {
  title: string;
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl p-5 bg-card border border-border">
      <div className="flex items-center gap-2 mb-3">
        <StatusDot ok={ok} />
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      </div>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export default function StatusGrid() {
  const { health, info, loading, error } = useServerStatus();
  const { connected } = useSocket();

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Connecting to server...</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="status-grid">
      <StatusCard title="API Health" ok={!!health}>
        {health ? (
          <>
            <p>Status: {health.status}</p>
          </>
        ) : (
          <p className="text-red-400">{error || 'Unable to reach server'}</p>
        )}
      </StatusCard>

      <StatusCard title="WebSocket" ok={connected}>
        <p>Status: {connected ? 'connected' : 'disconnected'}</p>
      </StatusCard>

      <StatusCard title="Environment" ok={!!info}>
        {info ? (
          <>
            <p>Mode: {info.environment}</p>
            <p>Port: {info.port}</p>
          </>
        ) : (
          <p className="text-red-400">{error || 'No data'}</p>
        )}
      </StatusCard>

      <StatusCard title="Runtime" ok={!!info}>
        {info ? (
          <>
            <p>Node: {info.nodeVersion}</p>
            <p>Uptime: {Math.floor(info.uptime)}s</p>
          </>
        ) : (
          <p className="text-red-400">{error || 'No data'}</p>
        )}
      </StatusCard>
    </div>
  );
}
