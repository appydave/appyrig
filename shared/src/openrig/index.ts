/**
 * OpenRig's real model, as Zod schemas + inferred types: what OpenRig itself stores for a rig, a
 * pod and a seat, and its project tree (missions and slices). Each file names the OpenRig source it
 * mirrors. Hand-written because OpenRig publishes no types or schema for these (see README.md).
 *
 * These are OpenRig's AUTHORED shapes (YAML files, chain files). AppyRig's own normalised
 * contract stays in ../snapshot.ts; OpenRig's daemon API shapes stay in
 * collector/src/adapters/openrigShapes.ts.
 */
export * from './startup.js';
export * from './rigSpec.js';
export * from './agentSpec.js';
export * from './chainFiles.js';
export * from './project.js';
