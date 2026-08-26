import { expect, test } from "@playwright/test";
import { startE2EServer, type StartedE2EServer } from "./harness/test-server.js";

test.describe("font size stepper", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  let server: StartedE2EServer;

  test.beforeAll(async () => {
    server = await startE2EServer({ sessions: ["main"], defaultSession: "main" });
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test("defaults to 11 on a phone viewport", async ({ page }) => {
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.getByTestId("font-size-value")).toHaveText("11");
  });

  test("clicking A+ persists the new size across a reload", async ({ page }) => {
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);

    const value = page.getByTestId("font-size-value");
    await expect(value).toHaveText("11");

    await page.getByTestId("font-size-increase").click();
    await expect(value).toHaveText("12");

    await page.reload();
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.getByTestId("font-size-value")).toHaveText("12");
  });

  test("A- is clamped at 1 and A+ is clamped at 14", async ({ page }) => {
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.getByTestId("font-size-value")).toHaveText("11");

    const increase = page.getByTestId("font-size-increase");
    for (let i = 0; i < 3; i++) {
      await increase.click();
    }
    await expect(page.getByTestId("font-size-value")).toHaveText("14");
    await expect(increase).toBeDisabled();

    const decrease = page.getByTestId("font-size-decrease");
    for (let i = 0; i < 13; i++) {
      await decrease.click();
    }
    await expect(page.getByTestId("font-size-value")).toHaveText("1");
    await expect(decrease).toBeDisabled();
  });

  test("decreasing the size from 11 to 10 records a new PTY resize", async ({ page }) => {
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.getByTestId("font-size-value")).toHaveText("11");

    await expect
      .poll(() => server.ptyFactory.latestProcess().resizes.length)
      .toBeGreaterThan(0);
    const resizesBefore = server.ptyFactory.latestProcess().resizes.length;

    await page.getByTestId("font-size-decrease").click();
    await expect(page.getByTestId("font-size-value")).toHaveText("10");

    await expect
      .poll(() => server.ptyFactory.latestProcess().resizes.length)
      .toBeGreaterThan(resizesBefore);
  });
});