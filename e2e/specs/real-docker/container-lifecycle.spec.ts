import { test, expect, LOCAL_SYSTEM_ID, waitForAppReady } from '../../support/real-docker-fixtures';
import {
  runDetached,
  listContainers,
  removeIfExists,
  ensureImage,
  performContainerAction,
} from '../../support/docker-bridge';

test.describe('Real Docker — container lifecycle', () => {
  test('UI reflects start/stop/remove transitions against docker ps', async ({ page, resourcePrefix }) => {
    const name = `${resourcePrefix}nginx`;

    await ensureImage('nginx:alpine');
    await removeIfExists('container', name);
    await runDetached({ name, image: 'nginx:alpine' });

    await page.goto('/containers');
    await waitForAppReady(page);

    // Scope all action button clicks to the card that actually belongs to our
    // container. The list renders many cards with identical action labels —
    // `getByRole('button', { name: 'Stop' }).first()` would otherwise hit the
    // first running container, not ours.
    const card = page.locator('div.rounded-xl').filter({ hasText: name }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Running → Stop via UI
    await card.getByRole('button', { name: 'Stop', exact: true }).click();
    const confirmStop = page.getByRole('dialog').getByRole('button', { name: /^(stop|confirm|yes)$/i });
    await expect(confirmStop).toBeVisible({ timeout: 5_000 });
    await confirmStop.click();

    await expect.poll(async () => {
      const all = await listContainers(LOCAL_SYSTEM_ID);
      return all.find((c) => c.name.includes(name))?.state;
    }, { timeout: 30_000, intervals: [1_000, 2_000] }).toBe('exited');

    // Stopped → Start via UI. Refresh first so the UI sees the new state.
    await page.getByRole('button', { name: 'Refresh containers' }).click().catch(() => {});
    await expect(card.getByRole('button', { name: 'Start', exact: true })).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    const confirmStart = page.getByRole('dialog').getByRole('button', { name: /^(start|confirm|yes)$/i });
    if (await confirmStart.count().catch(() => 0)) {
      await confirmStart.first().click();
    }

    await expect.poll(async () => {
      const all = await listContainers(LOCAL_SYSTEM_ID);
      return all.find((c) => c.name.includes(name))?.state;
    }, { timeout: 30_000, intervals: [1_000, 2_000] }).toBe('running');

    // Remove via bridge (UI remove path confirmed separately). Verify it disappears.
    await performContainerAction((await listContainers(LOCAL_SYSTEM_ID)).find((c) => c.name.includes(name))!.id, 'remove');
    await page.getByRole('button', { name: 'Refresh containers' }).click().catch(() => {});

    await expect.poll(async () => {
      const all = await listContainers(LOCAL_SYSTEM_ID);
      return all.some((c) => c.name.includes(name));
    }, { timeout: 15_000 }).toBe(false);
  });
});
