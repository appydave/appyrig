/**
 * The workflows read: specs and instances, two parts behind one push (see parts.ts for the rules).
 */
import { type WorkflowsData } from '@appydave/shared';
import {
  parseWorkflowInstances,
  parseWorkflowSpecs,
} from '@collector/adapters/daemondata/parse/workflows.js';
import { type DaemonGet } from '@collector/adapters/daemondata/reads/get.js';
import { type FailureLog, type Outcome } from '@collector/adapters/daemondata/reads/outcome.js';
import { readParts } from '@collector/adapters/daemondata/reads/parts.js';

export function readWorkflows(ctx: { get: DaemonGet; failures: FailureLog }): Promise<Outcome[]> {
  return readParts<WorkflowsData>(ctx, 'workflows', {
    specs: { path: '/api/workflow/specs', parse: parseWorkflowSpecs },
    instances: { path: '/api/workflow/list', parse: parseWorkflowInstances },
  });
}
