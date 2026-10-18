/**
 * The v2 kit. Every v2 page uses these, so mocks and sample data look the same everywhere.
 * Import from `client/src/v2/kit/index.js` (from a page: `../../kit/index.js`).
 */
export { default as MockMark, MOCK_TEXT } from './MockMark.js';
export { default as FakeControl, useFakeAction, type FakePhase } from './FakeControl.js';
export { default as MockNote, MOCK_NOTE_TEXT, useMockNote } from './MockNote.js';
export {
  default as SampleData,
  SampleLabel,
  SAMPLE_TEXT,
  realNames,
  type RealNames,
} from './SampleData.js';
