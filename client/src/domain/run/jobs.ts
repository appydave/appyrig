/**
 * Run board · the jobs of a mission come from the shared parser (`parseMissionJobs`), read from the
 * "Jobs" table of the rig's own MISSION.md. This file only gives the page its short names.
 */
export { parseMissionJobs } from '@appydave/shared';
export type { MissionJob as JobRow } from '@appydave/shared';
