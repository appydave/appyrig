import {
  POD_MEMBERS_MAX,
  RIG_EDGES_MAX,
  RIG_ENV_NAMES_MAX,
  RIG_SUMMARY_MAX,
  type OpenRig,
  type RigPod,
  type RigSpecView,
} from '@appydave/shared';
import { redactDeep, redactString } from '../redact.js';

/**
 * How a validated rig.yaml's pods and rig-level fields travel (the snapshot's spec fields and N10's
 * rig specs share them). Text is redacted; env travels as names only.
 */

/** One pod of a validated rig.yaml as the snapshot carries it: members by id, text redacted. */
export function podOf(pod: OpenRig.PodSpec): RigPod {
  const summary = pod.summary?.replace(/\s+/g, ' ').trim();
  const out: RigPod = {
    id: pod.id,
    label: pod.label,
    members: pod.members.map((m) => m.id).slice(0, POD_MEMBERS_MAX),
  };
  if (summary) {
    out.summary = redactString(summary).slice(0, RIG_SUMMARY_MAX);
  }
  if (pod.continuity_policy) {
    out.continuity_policy = pod.continuity_policy;
  }
  if (pod.startup) {
    out.startup = redactDeep(pod.startup);
  }
  if (pod.edges) {
    out.edges = pod.edges.slice(0, RIG_EDGES_MAX);
  }

  return out;
}

/** The rig-level fields of a validated rig.yaml: env reduced to its names, text redacted. */
export function rigSpecOf(spec: OpenRig.RigSpec): RigSpecView {
  const { version, culture_file, non_interruptive, permission_policy, managed_blocks } = spec;
  const out: RigSpecView = { version };
  if (culture_file !== undefined) {
    out.culture_file = culture_file;
  }
  if (non_interruptive !== undefined) {
    out.non_interruptive = non_interruptive;
  }
  if (permission_policy !== undefined) {
    out.permission_policy = permission_policy;
  }
  if (managed_blocks !== undefined) {
    out.managed_blocks = managed_blocks;
  }
  if (spec.docs) {
    out.docs = spec.docs;
  }
  if (spec.startup) {
    out.startup = redactDeep(spec.startup);
  }
  if (spec.services) {
    out.services = redactDeep(spec.services);
  }
  if (spec.workspace) {
    out.workspace = spec.workspace;
  }
  if (spec.env) {
    out.envNames = Object.keys(spec.env).slice(0, RIG_ENV_NAMES_MAX);
  }

  return out;
}
