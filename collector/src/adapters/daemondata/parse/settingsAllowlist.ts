/**
 * Which OpenRig settings may leave the machine at all: the exact-key allowlist, as data. The rules
 * that apply it (and withhold path-, session- or secret-looking keys even if listed) are in settings.ts.
 * client/src/pages/w5b.test.tsx reads this file's text to check the sample settings against the list.
 */

/**
 * The settings the hub may carry: an exact-key allowlist (never a prefix), chosen from OpenRig 0.6.6's
 * `/api/config` as numbers, flags and short enums that say how the daemon behaves. A key a newer
 * OpenRig adds is withheld until it is listed here.
 */
export const SETTINGS_ALLOW: readonly string[] = [
  'context.system_world',
  'daemon.host',
  'daemon.port',
  'feed.subscriptions.action_required',
  'feed.subscriptions.approvals',
  'feed.subscriptions.audit_log',
  'feed.subscriptions.progress',
  'feed.subscriptions.shipped',
  'health.context_pressure.critical_percent',
  'health.context_pressure.warning_percent',
  'host.name',
  'host.selected',
  'launch.non_interruptive',
  'onboarding.default_pack.enabled',
  'policies.claude_compaction.enabled',
  'policies.claude_compaction.threshold_percent',
  'policies.idle_gate_qitem.active_wake_interval_seconds',
  'policies.idle_gate_qitem.auto_register',
  'policies.idle_gate_qitem.scan_interval_seconds',
  'queue.pickup_stall_threshold_minutes',
  'queue.stuck_sweep_interval_seconds',
  'queue.stuck_sweep_unclaimed_age_minutes',
  'queue.wake_retry_cap',
  'queue.wake_retry_interval_seconds',
  'queue.wake_swap_grace_seconds',
  'queue.wake_unconfirmed_window_minutes',
  'recovery.auto_drive_provider_prompts',
  'retention.batch_size',
  'retention.enabled',
  'retention.transitions_days',
  'retention.usage_samples_days',
  'retention.watchdog_days',
  'retention.watchdog_keep_per_job',
  'runtime.codex.hooks_enabled',
  'runtime.readiness_timeout_seconds',
  'snapshots.periodic.enabled',
  'snapshots.periodic.interval_seconds',
  'snapshots.periodic.retention_keep',
  'terminal.status_bar',
  'transcripts.enabled',
  'transcripts.lines',
  'transcripts.poll_interval_seconds',
  'ui.enabled',
  'ui.preview.default_lines',
  'ui.preview.max_pins',
  'ui.preview.refresh_interval_seconds',
  'ui.terminal.max_live_terminals',
  'ui.timezone',
];
