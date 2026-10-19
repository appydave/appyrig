import type { V2PageDef, V2PageProps } from '../../types.js';
import { GraphV2 } from '../graph/index.js';

/**
 * `map` is Current's Rig Map view. In v2 the Rig Map is the "rig open" zoom level of the merged
 * Graph, so this key is an alias: it opens the Graph with the chosen rig already open in place.
 */
function RigMapAlias(props: V2PageProps) {
  return <GraphV2 {...props} focusChosen />;
}

export const page: V2PageDef = {
  key: 'map',
  label: 'Rig Map',
  group: 'fleet',
  component: RigMapAlias,
  blurb: 'The Graph with the chosen rig open: pods, compact agent cards and handoff lines.',
};
