import { test, expect, waitForAppReady } from '../../support/real-docker-fixtures';
import {
  runDetached,
  removeIfExists,
  ensureImage,
} from '../../support/docker-bridge';

test.describe('Real Docker — container logs', () => {
  test('get_container_logs returns the expected output from a running container', async ({ page, resourcePrefix }) => {
    const name = `${resourcePrefix}logs`;
    const marker = `MARKER-${resourcePrefix}`;

    await ensureImage('alpine:3.19');
    await removeIfExists('container', name);
    const id = await runDetached({
      name,
      image: 'alpine:3.19',
      cmd: ['sh', '-c', `echo ${marker}; sleep 5`],
    });

    await page.goto('/containers');
    await waitForAppReady(page);

    // Drive the IPC surface directly — exercises shim → bridge → real docker.
    const logs = await page.evaluate(async (cid) => {
      const tauri = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      return tauri.invoke('get_container_logs', { containerId: cid, tail: 100 });
    }, id);

    expect(String(logs ?? '')).toContain(marker);

    // Best-effort UI smoke: if a Logs button for this row is reachable, click
    // it. We don't assert the pane content here — that UI is covered by the
    // CON-35 shallow suite.
    const card = page.locator('div.rounded-xl').filter({ hasText: name }).first();
    const logsBtn = card.getByRole('button', { name: 'Logs' });
    if (await logsBtn.count().catch(() => 0)) {
      await logsBtn.click().catch(() => {});
    }
  });
});
