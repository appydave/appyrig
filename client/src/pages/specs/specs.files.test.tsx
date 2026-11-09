import { describe, expect, it } from 'vitest';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { rigFileMeta as meta, specsAnswer } from '@client/test/specsFixtures.js';
import { answeringSocket, pageCtx } from '@client/pages/page-test-kit.js';
import { page as specsPage } from './index.js';

// these tests wait on several round trips; give them room when the whole suite is busy
configure({ asyncUtilTimeout: 4000 });

const NOW = Date.parse('2026-10-20T12:00:00.000Z');

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

  it('groups the files: Next to rig.yaml and Named in rig.yaml, labels are not buttons', async () => {
    withFiles();
    await waitFor(() => expect(screen.getAllByTestId('rs-item')).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('rs-item')[1]!);
    await waitFor(() => expect(screen.getAllByTestId('rs-file')).toHaveLength(3));

    const labels = screen.getAllByTestId('rs-file-group');

    expect(labels.map((l) => l.textContent)).toEqual(['Next to rig.yaml', 'Named in rig.yaml']);
    expect(labels.every((l) => l.closest('button') === null)).toBe(true);
    expect(screen.getAllByTestId('rs-file')).toHaveLength(3);

    const next = screen.getByRole('list', { name: 'Next to rig.yaml' });
    const named = screen.getByRole('list', { name: 'Named in rig.yaml' });

    expect(next.textContent).toContain('rig.yaml');
    expect(next.textContent).toContain('CULTURE.md');
    expect(named.textContent).toContain('RUNBOOK.md');
    expect(named.textContent).not.toContain('named in rig.yaml');
    expect(screen.getAllByTestId('rs-file')[0]).toHaveAttribute('aria-pressed', 'true');
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
