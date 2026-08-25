import { expect, test } from "@playwright/test";
import { startE2EServer, type StartedE2EServer } from "./harness/test-server.js";

test.describe("toolbar does not open the terminal keyboard", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });

  let server: StartedE2EServer;

  test.beforeAll(async () => {
    server = await startE2EServer({ sessions: ["main"], defaultSession: "main" });
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test("toolbar keys send input without focusing the terminal textarea", async ({ page }) => {
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect.poll(() => server.ptyFactory.processes.length).toBeGreaterThan(0);

    const writesBefore = server.ptyFactory.latestProcess().writes.length;
    await page.getByRole("button", { name: "Enter", exact: true }).click();

    await expect.poll(() => server.ptyFactory.latestProcess().writes.length).toBeGreaterThan(writesBefore);
    await expect(page.locator(".terminal-host textarea")).not.toBeFocused();
    await expect(page.getByPlaceholder("Compose command")).not.toBeFocused();
  });

  test("compose field can be focused and the KB button focuses the terminal", async ({ page }) => {
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);

    await page.getByPlaceholder("Compose command").click();
    await expect(page.getByPlaceholder("Compose command")).toBeFocused();
    await expect(page.locator(".terminal-host textarea")).not.toBeFocused();

    await page.getByTestId("keyboard-toggle").click();
    await expect(page.locator(".terminal-host textarea")).toBeFocused();
  });
});
