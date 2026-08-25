import { expect, test, type Page } from "@playwright/test";
import { startE2EServer, type StartedE2EServer } from "./harness/test-server.js";

const swipeTerminal = async (page: Page, direction: "up" | "down"): Promise<void> => {
  const host = page.getByTestId("terminal-host");
  const box = await host.boundingBox();
  if (!box) {
    throw new Error("terminal host has no box");
  }
  const x = box.x + box.width / 2;
  const startY = direction === "up" ? box.y + box.height * 0.82 : box.y + box.height * 0.25;
  const endY = direction === "up" ? box.y + box.height * 0.18 : box.y + box.height * 0.85;
  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, endY, { steps: 16 });
  await page.mouse.up();
};

test.describe("mouse toggle and in-place history", () => {
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

  test("toolbar mouse button flips session mouse and shows state", async ({ page }) => {
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);

    const toggle = page.getByTestId("mouse-toggle");
    await expect(toggle).toHaveText("Mouse off");

    await toggle.click();
    await expect(toggle).toHaveText("Mouse");
    await expect
      .poll(() => server.tmux.calls.some((call) => call.startsWith("setMouse:") && call.endsWith(":true")))
      .toBe(true);

    await toggle.click();
    await expect(toggle).toHaveText("Mouse off");
    await expect
      .poll(() => server.tmux.calls.some((call) => call.startsWith("setMouse:") && call.endsWith(":false")))
      .toBe(true);
  });

  test("swipe up with mouse off shows in-place history at the latest line", async ({ page }) => {
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    const toggle = page.getByTestId("mouse-toggle");
    if ((await toggle.textContent()) === "Mouse") {
      await toggle.click();
    }
    await expect(toggle).toHaveText("Mouse off");
    await expect(page.locator(".terminal-host textarea")).toHaveCount(1);
    await expect
      .poll(async () =>
        page.locator(".terminal-host").evaluate((el) => getComputedStyle(el).touchAction)
      )
      .toBe("none");

    await swipeTerminal(page, "up");

    const history = page.getByTestId("history-surface");
    await expect(history).toBeVisible();
    await expect(page.locator(".scrollback-card")).toHaveCount(0);
    await expect(page.getByTestId("history-text")).toContainText("latest-line for");

    const position = await page.getByTestId("history-text").evaluate((el) => ({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight
    }));
    expect(position.scrollTop + position.clientHeight).toBeGreaterThanOrEqual(position.scrollHeight - 4);

    await history.click();
    await expect(history).toHaveCount(0);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.getByTestId("terminal-host")).toBeVisible();
  });

  test("swipe with mouse on does not open history", async ({ page }) => {
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);

    const toggle = page.getByTestId("mouse-toggle");
    if ((await toggle.textContent()) !== "Mouse") {
      await toggle.click();
    }
    await expect(toggle).toHaveText("Mouse");
    await expect
      .poll(async () =>
        page.locator(".terminal-host").evaluate((el) => getComputedStyle(el).touchAction)
      )
      .toBe("none");

    const capturesBefore = server.tmux.calls.filter((call) => call.startsWith("capturePane:")).length;
    const writesBefore = server.ptyFactory.latestProcess().writes.length;
    await swipeTerminal(page, "up");
    await expect(page.getByTestId("history-surface")).toHaveCount(0);
    await expect(page.locator(".scrollback-card")).toHaveCount(0);
    expect(server.tmux.calls.filter((call) => call.startsWith("capturePane:")).length).toBe(
      capturesBefore
    );
    await expect
      .poll(() =>
        server.ptyFactory.latestProcess().writes.slice(writesBefore).join("").includes("\x1b[<65;")
      )
      .toBe(true);
  });
});

test.describe("stored mouse preference", () => {
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

  test("applies the stored mouse preference on attach", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tmux-mobile-mouse", "true");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.getByTestId("mouse-toggle")).toHaveText("Mouse");
    await expect
      .poll(() => server.tmux.calls.some((call) => call.startsWith("setMouse:") && call.endsWith(":true")))
      .toBe(true);
  });
});

