import { expect, test } from "@playwright/test";
import { startE2EServer, type StartedE2EServer } from "./harness/test-server.js";

test.describe("websocket reconnect", () => {
  let server: StartedE2EServer;

  test.beforeAll(async () => {
    server = await startE2EServer({ sessions: ["main"], defaultSession: "main" });
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test("reconnects after the network drops without a page reload", async ({ page }) => {
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        navigations.push(frame.url());
      }
    });

    await page.goto(`${server.baseUrl}/?token=${server.token}&debug=1`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.getByTestId("reconnect-overlay")).toHaveCount(0);
    const navigationsAfterLoad = navigations.length;

    const processesBeforeDrop = server.ptyFactory.processes.length;
    expect(processesBeforeDrop).toBeGreaterThan(0);

    await page.evaluate(() => {
      window.__tmuxMobileDebugSockets?.control?.close();
      window.__tmuxMobileDebugSockets?.terminal?.close();
    });

    await expect(page.getByTestId("reconnect-overlay")).toBeVisible();
    await expect(page.getByTestId("reconnect-overlay")).toContainText(/reconnect/i);

    await expect(page.getByTestId("reconnect-overlay")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);

    await expect.poll(() => server.ptyFactory.processes.length).toBeGreaterThan(processesBeforeDrop);
    expect(navigations.length).toBe(navigationsAfterLoad);
  });

  test("does not reconnect just because the tab became visible", async ({ page }) => {
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);

    const processesBefore = server.ptyFactory.processes.length;
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      return new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    expect(server.ptyFactory.processes.length).toBe(processesBefore);
    await expect(page.getByTestId("reconnect-overlay")).toHaveCount(0);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
  });
});
