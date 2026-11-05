import { describe, expect, it } from 'vitest';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RigFileMeta, RigSpecsOutput } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { answeringSocket, pageCtx } from '@client/pages/page-test-kit.js';
import { page as specsPage } from './index.js';

// these tests wait on several round trips; give them room when the whole suite is busy
configure({ asyncUtilTimeout: 4000 });

const NOW = Date.parse('2026-10-20T12:00:00.000Z');

/** One draft (spaghetti) and one launched rig, as rig.specs sends them. */
function specsAnswer(
  machine: string,
  launchedName: string,
  launchedStatus: string
): RigSpecsOutput {
  const base = { machine, specValid: true, summary: null, pods: [], specEdges: [], agents: [] };

  return {
    machines: [{ machine, status: 'ok', reason: null, collectedAt: '2026-10-20T11:59:00.000Z' }],
    specs: [
      {
        ...base,
        name: 'spaghetti',
        launched: false,
        rigStatus: null,
        launchedOn: [],
        specPath: '/Users/x/rigs/spaghetti/rig.yaml',
      },
      {
        ...base,
        name: launchedName,
        launched: true,
        rigStatus: launchedStatus,
        launchedOn: [{ machine, status: launchedStatus }],
        specPath: '/x/rig.yaml',
      },
    ],
  };
}

const meta = (id: string, name: string, over: Partial<RigFileMeta> = {}) => ({
  id,
  name,
  scope: 'spec' as const,
  bytes: 40,
  modifiedAt: '2026-10-20T10:00:00.000Z',
  truncated: false,
  ...over,
});
const RIG_YAML = 'name: x\nlong: ' + 'word '.repeat(80) + '\n  indented: 1\n';

describe('V67: the files are the main view', () => {
  function withFiles(extra: { 'rig.file'?: (i: { fileId: string }) => unknown } = {}) {
    const m2 = fleetMachine(snapshot('m2'));
    const launched = m2.snapshot.rigs[0]!;
    const { socket, sent } = answeringSocket({
      'rig.specs': specsAnswer('m2', launched.name, launched.status),
      'rig.commands': () => ({ machines: [], commands: [] }),
      'rig.files': () => ({
        machine: 'm2',
        rig: launched.name,
        status: 'ok',
        reason: null,
        files: [meta('spec:CULTURE.md', 'CULTURE.md'), meta('spec:rig.yaml', 'rig.yaml')],
        specFiles: [meta('rig:RUNBOOK.md', 'RUNBOOK.md', { scope: 'rig', truncated: true })],
      }),
      'rig.file': (i: { fileId: string }) =>
        i.fileId === 'spec:rig.yaml'
          ? {
              machine: 'm2',
              rig: launched.name,
              file: { ...meta(i.fileId, 'rig.yaml'), content: RIG_YAML },
            }
          : undefined,
      ...extra,
    });

    render(<specsPage.component ctx={pageCtx([m2], socket, NOW)} />);

    return { sent, launched };
  }

  it('says what the page is for', async () => {
    withFiles();
    expect(screen.getByTestId('rs-purpose')).toHaveTextContent(
      'The rigs written on disk, launched or not.'
    );
  });

  it('a launched rig lists rig.yaml first and shows its text exactly, with the Summary closed', async () => {
    withFiles();
    await waitFor(() => expect(screen.getAllByTestId('rs-item')).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('rs-item')[1]!);
    await waitFor(() => expect(screen.getAllByTestId('rs-file')).toHaveLength(3));
    expect(screen.getAllByTestId('rs-file')[0]).toHaveTextContent('rig.yaml');
    await waitFor(() => expect(screen.getByTestId('rs-file-text').textContent).toBe(RIG_YAML));
    expect(screen.getByTestId('rs-summary-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('rs-summary-body')).toBeNull();
    expect(screen.getByTestId('rs-detail-folder')).toHaveTextContent('/x');

    fireEvent.click(screen.getByTestId('rs-summary-toggle'));
    expect(screen.getByTestId('rs-summary-body')).toBeInTheDocument();
  });

  it('says so when a file is cut or cannot be read', async () => {
    withFiles();
    await waitFor(() => expect(screen.getAllByTestId('rs-item')).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('rs-item')[1]!);
    await waitFor(() => expect(screen.getAllByTestId('rs-file')).toHaveLength(3));
    fireEvent.click(screen.getAllByTestId('rs-file')[2]!);
    await waitFor(() => expect(screen.getByTestId('rs-file-refused')).toBeInTheDocument());
  });

  it('a file the hub cut says so, and the text stays as sent', async () => {
    withFiles({
      'rig.file': (i: { fileId: string }) => ({
        machine: 'm2',
        rig: 'r',
        file: { ...meta(i.fileId, 'x', { truncated: true }), content: 'first line' },
      }),
    });
    await waitFor(() => expect(screen.getAllByTestId('rs-item')).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('rs-item')[1]!);
    await waitFor(() => expect(screen.getByTestId('rs-file-truncated')).toBeInTheDocument());
    expect(screen.getByTestId('rs-file-text').textContent).toBe('first line');
  });

  it('a draft has no files from the hub: it says so in words and opens the Summary', async () => {
    const { sent } = withFiles();

    await waitFor(() => expect(screen.getAllByTestId('rs-item')).toHaveLength(2));
    expect(screen.getByTestId('rs-files-none')).toHaveTextContent(/not launched/);
    expect(screen.getByTestId('rs-summary-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(sent).not.toContain('rig.files');
  });
});
