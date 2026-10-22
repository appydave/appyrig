/**
 * The kit: shared UI every page uses, so mocks and sample data look the same everywhere.
 * Import from `client/src/kit/index.js` (from a page: `../../kit/index.js`). Business logic lives in
 * `client/src/domain/`; some of it is re-exported here for the pages' convenience.
 */
export { default as MockMark, MOCK_TEXT } from './MockMark.js';
export { default as FakeControl, useFakeAction } from './FakeControl.js';
export { default as MockNote, MOCK_NOTE_TEXT } from './MockNote.js';
export { PageHeader, MockMenu } from './PageHeader.js';
export { default as SampleData, SampleLabel, realNames } from './SampleData.js';
export {
  LINE_EXPLAIN,
  LINE_HEAVY_FROM,
  LINE_LEGEND,
  LINE_MEDIUM_FROM,
  LINE_WIDTH,
  LINE_WIDTH_CAP,
  PLANNED_DASH,
  arrowHeads,
  lineFocusId,
  lineFocusState,
  lineMarks,
  lineStep,
  lineWidth,
  mergePairs,
  pairLabel,
  podRail,
  relativeWidthLines,
} from '@client/domain/lines/handoffLines.js';
export { useLineFocus } from './useLineFocus.js';
export {
  HandoffLegend,
  LeftOpenBadgeSvg,
  LineMarksChips,
  WaitingBadgeSvg,
  labelClass,
  lineClass,
} from './HandoffLineMarks.js';
export { default as TerminalCard, tailLine } from './TerminalCard.js';
export { DocsLayout, useDocsDrawer } from './DocsDrawer.js';
export { default as SkillsPanel } from './SkillsPanel.js';

export { default as AgentPanel } from './AgentPanel.js';

export { default as Legend2 } from './Legend2.js';
export { LEGEND_TITLE } from './legendData.js';
export { default as PageInfo } from './PageInfo.js';
export { PAGE_PURPOSE } from './legendData.js';
export { default as WallCard } from './WallCard.js';
