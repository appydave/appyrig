/**
 * The v2 kit. Every v2 page uses these, so mocks and sample data look the same everywhere.
 * Import from `client/src/v2/kit/index.js` (from a page: `../../kit/index.js`).
 */
export { default as MockMark, MOCK_TEXT } from './MockMark.js';
export { default as FakeControl, useFakeAction, type FakePhase } from './FakeControl.js';
export { default as MockNote, MOCK_NOTE_TEXT, useMockNote } from './MockNote.js';
export { PageHeader, MockMenu } from './PageHeader.js';
export {
  default as SampleData,
  SampleLabel,
  SAMPLE_TEXT,
  realNames,
  type RealNames,
} from './SampleData.js';
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
  pairKey,
  pairLabel,
  podRail,
  relativeWidthLines,
  useLineFocus,
  type FocusHandlers,
  type LegendEntry,
  type LineFocusState,
  type LineMarks,
  type LinePair,
  type LineStep,
  type PodEdge,
  type RawEdge,
} from './handoffLines.js';
export {
  HandoffLegend,
  LeftOpenBadgeSvg,
  LineMarksChips,
  WaitingBadgeSvg,
  labelClass,
  lineClass,
} from './HandoffLineMarks.js';
export {
  default as TerminalCard,
  SKILL_CHIPS,
  skillChips,
  tailLine,
  type CardSize,
  type TerminalCardProps,
} from './TerminalCard.js';
export {
  DocReader,
  DocsDrawer,
  DocsLayout,
  useDocsData,
  useDocsDrawer,
  type DocsTarget,
} from './DocsDrawer.js';
export { default as SkillsPanel } from './SkillsPanel.js';
export {
  buildDocItems,
  docKind,
  firstDoc,
  groupSkills,
  type DocItem,
  type DocGroup,
} from './docsModel.js';
export { default as AgentPanel, stripAnsi, type AgentPanelProps } from './AgentPanel.js';
export { useTopOffset, measureTopOffset } from './useTopOffset.js';
export { default as Legend2 } from './Legend2.js';
export {
  LEGEND_PAGES,
  LEGEND_TITLE,
  legendSections,
  type LegendMark,
  type LegendSection,
} from './legendData.js';
export { default as PageInfo } from './PageInfo.js';
export { PAGE_PURPOSE } from './legendData.js';
