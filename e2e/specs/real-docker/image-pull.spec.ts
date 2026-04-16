import { test, expect, LOCAL_SYSTEM_ID, waitForAppReady } from '../../support/real-docker-fixtures';
import { listImages, removeImage } from '../../support/docker-bridge';

test.describe('Real Docker — image pull', () => {
  test('pull_image command populates docker images and UI list', async ({ page }) => {
    const imageRef = 'alpine:3.19';

    // Make the pre-condition deterministic by removing any prior copy.
    try { await removeImage(imageRef); } catch { /* not present */ }

    await page.goto('/images');
    await waitForAppReady(page);

    // Invoke pull via the IPC surface the UI uses. This exercises the shim →
    // bridge → real `docker pull` path end-to-end.
    const output = await page.evaluate(async (image) => {
      const tauri = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
      return tauri.invoke('pull_image', { systemId: 'e2e-local-docker', image, runtime: 'Docker' });
    }, imageRef);

    // `docker pull` prints progress lines; completion line includes a digest / "Pulled".
    expect(String(output ?? '')).toMatch(/(Downloaded newer image|Image is up to date|sha256:)/i);

    // Daemon-level assertion.
    const host = await listImages(LOCAL_SYSTEM_ID);
    expect(host.some((i) => `${i.name}:${i.tag}` === imageRef || i.name === 'alpine')).toBe(true);

    // UI surfaces the newly-pulled image on refresh. Images are grouped by
    // system behind a collapsible card — click to expand before asserting.
    await page.getByRole('button', { name: /^Refresh$/i }).first().click().catch(() => {});
    const systemCard = page.getByRole('button', { name: /E2E Local Docker/i }).first();
    if (await systemCard.count().catch(() => 0)) {
      await systemCard.click();
    }

    await expect(page.getByText('alpine', { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    await removeImage(imageRef);
  });
});
