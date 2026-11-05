import type { SpecState } from './model.js';

/**
 * What each state chip means in plain words: what it is, how the rig got there, and what changes it.
 * Follows `stateOf` and `liveOf` above: the state comes from whether OpenRig has a record of the rig
 * (on this machine or another) and that record's status.
 */
export const STATE_HELP: Record<SpecState, string> = {
  draft:
    'Draft (not launched): the rig.yaml is written, but no OpenRig on any machine has a record of this rig, so there are no live seats. It stays a draft until someone starts it (rig up); then it becomes running. If OpenRig later forgets the rig, it goes back to draft.',
  running:
    'Running: OpenRig has this rig and its status is running (on this machine, or on another one that launched it from its own copy of the spec). It was a draft until it was started. It becomes "launched, not running" when the rig is stopped.',
  launched:
    'Launched, not running: OpenRig has a record of this rig, but its status is not running (stopped, for example). It got here by being started once and then stopped. Starting it again makes it running.',
};
