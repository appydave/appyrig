import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { openWall, watchErrors } from './support/fleet';

// v1.4 S7-ui: the rig files viewer and the OpenRig DB schema screen, against the fixture-fed hub.
// The fake collector replays fliedit-team's files (test/fixtures/rigfiles/) and the real OpenRig
// 0.6.6 database shape (test/fixtures/openrig-schema-0.6.6.json), after an invented older 0.6.5.

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures');
const schema = JSON.parse(
  readFileSync(path.join(fixtures, 'openrig-schema-0.6.6.json'), 'utf8')
) as {
  openrigVersion: string;
  tables: {
    name: string;
    kind: string;
    columns: { name: string }[];
    foreignKeys: { table: string }[];
  }[];
};

async function openFilesFor(page: Page, rigKey: string) {
  await page.getByTestId('view-map').click();
  await page.locator(`[data-testid="rig-chip"][data-rig-key="${rigKey}"]`).click();
  await page.getByTestId('rig-files-open').click();
  await expect(page.getByTestId('rig-files')).toBeVisible();
}

test.describe('v1.4 S7-ui: rig files', () => {
  test('rig.yaml is coloured and foldable; Markdown is rendered; a cut file says so; keys work', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await openFilesFor(page, 'm2:fliedit-team');
    const dialog = page.getByTestId('rig-files');
    // the collector sends files a moment after the first snapshot: wait for them, never sleep
    await expect(dialog.getByTestId('rig-file-item')).toHaveCount(4, { timeout: 15_000 });
    await expect(dialog.getByTestId('rig-file-item')).toContainText([
      'CULTURE.md',
      'LEARNED-dev-ui.md',
      'MISSION.md',
      'rig.yaml',
    ]);

    // rig.yaml opens first, as a YAML view with colour by token
    const yaml = dialog.getByTestId('yaml-view');
    await expect(yaml).toBeVisible();
    await expect(dialog.getByTestId('rig-file-name')).toHaveText('rig.yaml');
    await expect(yaml.locator('.y-key').first()).toHaveText('version');
    await expect(yaml.locator('.y-string').first()).toContainText('0.2');
    await expect(yaml.locator('.y-comment').first()).toContainText(
      'A fixture modelled on a real rig spec'
    );
    const lineCount = await yaml.locator('.yaml-line').count();
    // fold the "pods:" block: its lines disappear and the fold says how many
    const pods = yaml
      .locator('.yaml-line', { hasText: /^\s*\d+\s*[▾▸]?\s*pods:/ })
      .locator('[data-testid="yaml-fold"]');
    await pods.click();
    await expect(yaml.locator('.yaml-line')).not.toHaveCount(lineCount);
    await expect(yaml.locator('.y-folded')).toContainText(/… \d+ lines/);
    await dialog.getByTestId('yaml-unfold').click();
    await expect(yaml.locator('.yaml-line')).toHaveCount(lineCount);

    // arrow keys move between files; Markdown is rendered (heading, table, code, no raw HTML link)
    await page.keyboard.press('ArrowUp'); // rig.yaml is last: ↑ goes to MISSION.md
    const md = dialog.getByTestId('markdown-view');
    await expect(md).toBeVisible();
    await expect(md.getByRole('heading', { level: 1 })).toHaveText('Mission: FliEdit overlay gaps');
    await expect(md.getByRole('table')).toBeVisible();
    await expect(md.locator('tbody tr')).toHaveCount(3);
    await expect(md.locator('pre code')).toContainText('rig up fliedit-team/rig.yaml');
    await expect(dialog.getByTestId('md-front')).toBeVisible();
    // the unsafe link is plain text, and the safe one opens safely
    await expect(md.locator('a[href^="javascript"]')).toHaveCount(0);
    await expect(md.getByText('click me')).toBeVisible();
    await expect(md.locator('a[href="https://example.test/brief"]')).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    );
    // the source toggle
    await dialog.getByTestId('rig-file-source').click();
    await expect(md).toHaveCount(0);
    await expect(dialog.locator('pre.md-code')).toContainText('# Mission: FliEdit overlay gaps');

    // a file the collector cut says so
    await dialog.locator('[data-file-id="spec:LEARNED-dev-ui.md"]').click();
    await expect(dialog.getByTestId('rig-file-truncated')).toContainText(
      /first .* of this .* file/
    );

    // Esc closes the viewer only, and puts focus back on the button that opened it
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('view-body-map')).toBeVisible();
    await expect(page.getByTestId('rig-files-open')).toBeFocused();
    expect(errors, 'no console errors in the files viewer').toEqual([]);
  });

  test("O opens the chosen rig's files; the keys overlay lists it; a rig with no spec says why", async ({
    page,
  }) => {
    await openWall(page);
    await page.getByTestId('view-map').click();
    await page.locator('[data-testid="rig-chip"][data-rig-key="m2:fliedit-team"]').click();
    await page.keyboard.press('?');
    await expect(page.getByTestId('keys-help')).toContainText("Open the chosen rig's files");
    await expect(page.getByTestId('keys-files')).toContainText('move between files');
    await page.keyboard.press('Escape');
    await page.keyboard.press('o');
    await expect(page.getByTestId('rig-files')).toBeVisible();
    await page.keyboard.press('Escape');
    // kernel has no rig.yaml in the fixtures: the replay marks it not-found
    await page.locator('[data-testid="rig-chip"][data-rig-key="m2:kernel"]').click();
    await page.getByTestId('rig-files-open').click();
    const status = page.getByTestId('rig-files-status');
    await expect(status).toHaveAttribute('data-status', 'no-spec');
    await expect(status).toContainText(/No rig\.yaml/i);
    await expect(page.getByTestId('rig-file-item')).toHaveCount(0);
  });

  test('from a seat panel, Rig files opens the same viewer; Esc closes it, then the seat', async ({
    page,
  }) => {
    await openWall(page);
    await page.getByTestId('view-map').click();
    await page.locator('[data-testid="rig-chip"][data-rig-key="m2:fliedit-team"]').click();
    await page.getByTestId('rig-map').getByTestId('rig-map-node').first().click();
    await expect(page.getByTestId('focus-view')).toBeVisible();
    await page.getByTestId('focus-rig-files').click();
    await expect(page.getByTestId('rig-files')).toBeVisible();
    await expect(page.getByTestId('rig-file-item')).toHaveCount(4, { timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rig-files')).toHaveCount(0);
    await expect(page.getByTestId('focus-view')).toBeVisible(); // the seat panel is still there
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('focus-view')).toHaveCount(0);
  });
});

test.describe('v1.4 S7-ui: OpenRig DB schema', () => {
  test('lists the live tables, names the OpenRig version, shows what changed, searches and follows links', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await page.getByTestId('view-schema').click();
    const view = page.getByTestId('schema');
    await expect(page.getByTestId('view-body-schema')).toBeVisible();
    // the machine with a database is chosen once its answer is in
    await expect(view.getByTestId('schema-version')).toHaveText(schema.openrigVersion, {
      timeout: 15_000,
    });
    const tables = schema.tables.filter((t) => t.kind === 'table').length;
    const views = schema.tables.length - tables;
    await expect(view.getByTestId('schema-count')).toContainText(
      `${tables} tables · ${views} views`
    );
    await expect(view.getByTestId('schema-table')).toHaveCount(schema.tables.length);
    // the older fixture version came first, so there is a real change to show
    await expect(view.getByTestId('schema-changes')).toContainText(
      'Changed since 0.6.5 (fixture00)'
    );
    await expect(view.getByTestId('schema-changes')).toHaveAttribute('data-status', 'changed');
    await view.getByTestId('schema-diff').locator('summary').click();
    await expect(view.getByTestId('schema-diff')).toContainText('table');

    // search: "/" focuses it; filtering by name narrows the list
    await page.keyboard.press('/');
    await expect(view.getByTestId('schema-search')).toBeFocused();
    await page.keyboard.type('queue');
    const matching = schema.tables.filter((t) => t.name.includes('queue')).length;
    await expect(view.getByTestId('schema-table')).toHaveCount(matching);
    await expect(view.getByTestId('schema-shown')).toContainText(
      `${matching} of ${schema.tables.length} match`
    );
    await page.keyboard.press('Escape'); // clears the search…
    await expect(view.getByTestId('schema-search')).toHaveValue('');
    await expect(view.getByTestId('schema-table')).toHaveCount(schema.tables.length);

    // a table with a link: columns, primary key and a clickable arrow to the table it points at
    const withFk = schema.tables.find((t) => t.foreignKeys.length > 0)!;
    await view.locator(`[data-testid="schema-table"][data-table="${withFk.name}"]`).click();
    const detail = view.getByTestId('schema-detail');
    await expect(detail).toHaveAttribute('data-table', withFk.name);
    await expect(detail.getByTestId('schema-columns').locator('tbody tr')).toHaveCount(
      withFk.columns.length
    );
    const target = withFk.foreignKeys[0]!.table;
    await detail.getByTestId('schema-fk').first().click();
    await expect(view.getByTestId('schema-detail')).toHaveAttribute('data-table', target);
    await expect(view.getByTestId('schema-inbound')).toContainText(withFk.name);
    expect(errors, 'no console errors on the schema screen').toEqual([]);
  });

  test('a machine whose collector sends no schema says so plainly', async ({ page }) => {
    await openWall(page);
    await page.getByTestId('view-schema').click();
    await expect(page.getByTestId('schema-version')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="schema-machine"][data-machine-id="roamy"]').click();
    const status = page.getByTestId('schema-status');
    await expect(status).toHaveAttribute('data-status', 'no-data');
    await expect(status).toContainText('No database schema from Roamy');
    await expect(page.getByTestId('schema-version')).toHaveCount(0);
  });

  test('the legend names the new marks, and the screen is light-only', async ({ page }) => {
    await openWall(page);
    await page.getByTestId('view-schema').click();
    await expect(page.getByTestId('schema-version')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('l');
    const legend = page.getByTestId('legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('OpenRig database');
    for (const mark of ['NOT NULL', 'PK', '→ rigs.id', '+ table · ~ table'])
      await expect(legend).toContainText(mark);
    const scheme = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme
    );
    expect(scheme).toBe('light');
  });
});
