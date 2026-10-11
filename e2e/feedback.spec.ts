import { test, expect } from '@playwright/test';
import { openWall, watchErrors } from './support/fleet';

// v1.4 S8-ui done-when: file 3 notes with screenshots from inside AppyRig, then list them back.
// The e2e hub writes to its own temp DATA_DIR, so these notes never touch real state.

test.describe('v1.4 S8 feedback capture', () => {
  test('file three notes with screenshots from three screens, then list them back', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    const notes = [
      {
        go: null,
        verdict: 'down',
        text: 'The stopped groups should say how long they have been stopped.',
      },
      { go: 'view-map', verdict: 'question', text: 'What does the dashed band around a pod mean?' },
      {
        go: 'view-accounts',
        verdict: 'idea',
        text: 'Show yesterday’s 5-hour peak next to the bar.',
      },
    ];
    const filed: string[] = [];
    for (const n of notes) {
      if (n.go) await page.getByTestId(n.go).click();
      await page.keyboard.press('f');
      await expect(page.getByTestId('feedback-note')).toBeFocused();
      // The screenshot is drawn from the page before anything is sent.
      await expect(page.getByTestId('feedback-shot')).toHaveAttribute('data-state', 'ready', {
        timeout: 15_000,
      });
      await page.getByTestId(`feedback-verdict-${n.verdict}`).click();
      await page.getByTestId('feedback-note').fill(n.text);
      await page.getByTestId('feedback-note').press('ControlOrMeta+Enter');
      const toast = page.getByTestId('feedback-toast');
      await expect(toast).toContainText(/Filed fb-\d+ with a screenshot/);
      filed.push((await toast.innerText()).match(/fb-\d+/)![0]);
      await expect(page.getByTestId('feedback-composer')).toHaveCount(0);
      await toast.getByRole('button', { name: 'OK' }).click();
      await expect(toast).toHaveCount(0);
    }
    expect(new Set(filed).size).toBe(3);

    // Read them back the way an agent would: feedback.list over the API, screenshots by URL.
    const list = await page.evaluate(async () => {
      const r = await fetch('/v1/rpc', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-fli-principal': 'agent:e2e' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'feedback.list',
          params: { limit: 10 },
        }),
      });
      return r.json();
    });
    const rows = (list.result?.notes ?? list.result?.value?.notes ?? []) as {
      id: string;
      region: string;
      hasScreenshot: boolean;
    }[];
    for (const id of filed) {
      const row = rows.find((x) => x.id === id);
      expect(row, `feedback.list has ${id}`).toBeTruthy();
      expect(row!.hasScreenshot).toBe(true);
    }
    const regions = rows.filter((r) => filed.includes(r.id)).map((r) => r.region);
    expect(regions).toContain('wall');
    expect(regions).toContain('accounts');
    expect(
      regions.some((r) => r.startsWith('map:')),
      `a map region in ${regions}`
    ).toBe(true);
    const png = await page.request.get(`/v1/feedback/${filed[0]}/screenshot.png`);
    expect(png.status()).toBe(200);
    expect(png.headers()['content-type']).toContain('image/png');

    // The composer lists them too.
    await page.keyboard.press('f');
    await expect(page.getByTestId('feedback-recent')).toContainText(filed[2]!);
    await page.keyboard.press('Escape');
    expect(errors, 'no console errors').toEqual([]);
  });
});
