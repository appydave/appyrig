/**
 * Workflows: the workflow specs (GET /api/workflow/specs) and the running and finished instances
 * (GET /api/workflow/list), shaped for the Workflows page. A spec needs a name, an instance needs an
 * id; any other odd field drops only that field.
 */
import {
  TEXT_XLONG_MAX,
  TEXT_MEDIUM_MAX,
  TEXT_XXXLONG_MAX,
  TEXT_SHORT_MAX,
  type WorkflowsData,
} from '@appydave/shared';
import {
  bool,
  countOrNull,
  isRec,
  kept,
  num,
  recOf,
  rowsOf,
  txt,
} from '@collector/adapters/daemondata/parse/lenient.js';

const WORKFLOW_SPECS_MAX = 200;
const WORKFLOW_INSTANCES_MAX = 300;

type WorkflowSpec = NonNullable<WorkflowsData['specs']>[number];
type WorkflowInstance = NonNullable<WorkflowsData['instances']>[number];

/** A version as text: a string, or a number written out; null for anything else. */
const versionText = (v: unknown): string | null =>
  txt(v, TEXT_SHORT_MAX) ?? (num(v) !== null ? String(v) : null);

/** The coordination terminal-turn rule, else the plain one. */
const terminalTurnRuleOf = (coordination: unknown, plain: unknown): string | null =>
  txt(coordination, TEXT_MEDIUM_MAX) ?? txt(plain, TEXT_MEDIUM_MAX);

/** One workflow spec; a row with no name is not a spec. */
function specOf(raw: unknown): WorkflowSpec | null {
  const name = isRec(raw) ? txt(raw.name, TEXT_XLONG_MAX) : null;

  if (!isRec(raw) || !name) {
    return null;
  }

  return {
    name,
    version: versionText(raw.version),
    purpose: txt(raw.purpose, TEXT_XXXLONG_MAX, true),
    targetRig: txt(raw.targetRig, TEXT_XLONG_MAX),
    terminalTurnRule: terminalTurnRuleOf(raw.coordinationTerminalTurnRule, raw.terminalTurnRule),
    isBuiltIn: bool(raw.isBuiltIn),
  };
}

export function parseWorkflowSpecs(raw: unknown): NonNullable<WorkflowsData['specs']> {
  return kept(rowsOf(raw, 'specs'), specOf).slice(0, WORKFLOW_SPECS_MAX);
}

/** One workflow instance; a row with no instance id is not an instance. */
function instanceOf(raw: unknown): WorkflowInstance | null {
  const instanceId = isRec(raw) ? txt(raw.instanceId, TEXT_XLONG_MAX) : null;

  if (!isRec(raw) || !instanceId) {
    return null;
  }

  return {
    instanceId,
    workflowName: txt(raw.workflowName, TEXT_XLONG_MAX),
    workflowVersion: versionText(raw.workflowVersion),
    status: txt(raw.status, TEXT_SHORT_MAX),
    currentStepId: txt(raw.currentStepId, TEXT_XLONG_MAX),
    hopCount: countOrNull(raw.hopCount),
    createdAt: txt(raw.createdAt, TEXT_SHORT_MAX),
    completedAt: txt(raw.completedAt, TEXT_SHORT_MAX),
    deadlineState: txt(recOf(raw.deadline).state, TEXT_SHORT_MAX),
  };
}

export function parseWorkflowInstances(raw: unknown): NonNullable<WorkflowsData['instances']> {
  return kept(rowsOf(raw, 'instances'), instanceOf).slice(0, WORKFLOW_INSTANCES_MAX);
}
