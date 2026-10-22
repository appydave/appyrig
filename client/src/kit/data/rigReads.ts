import type { RigFileOutput, RigFilesOutput, RigWaitingOutput } from '@appydave/shared';
import { callVerb } from '@client/domain/fleet/coreCall.js';

type Socket = Parameters<typeof callVerb>[0];

/**
 * The read verbs about one rig, named and typed once. domain/fleet/coreCall.ts is the transport (any verb, any
 * input); these are the three reads that pages and the kit make over and over, so a caller says
 * `readRigFiles(socket, { machine, rig })` and not the verb's name and result type again.
 */

/** The files of one rig (`rig.files`). */
export const readRigFiles = (socket: Socket, input: { machine: string; rig: string }) =>
  callVerb<RigFilesOutput>(socket, 'rig.files', input);

/** One file of a rig, by the id `readRigFiles` listed (`rig.file`). */
export const readRigFile = (
  socket: Socket,
  input: { machine: string; rig: string; fileId: string }
) => callVerb<RigFileOutput>(socket, 'rig.file', input);

/** What a rig is waiting on: its gates and its ssh address (`rig.waiting`). */
export const readRigWaiting = (socket: Socket, input: { machine: string; rig: string }) =>
  callVerb<RigWaitingOutput>(socket, 'rig.waiting', input);
