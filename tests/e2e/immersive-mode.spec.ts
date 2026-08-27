import { expect, test } from "@playwright/test";
import { startE2EServer, type StartedE2EServer } from "./harness/test-server.js";

test.describe("immersive mode", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  let server: StartedE2EServer;

  test.beforeAll(async () => {
    server = await startE2EServer({ sessions: ["main"], defaultSession: "main" });
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("defaults to data-immersive=false on a fresh phone viewport", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tmux-mobile-immersive");
      localStorage.removeItem("tmux-mobile-immersive-hint-seen");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "false");
  });

  test("shows the first-run hint once and hides it after dismissal", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tmux-mobile-immersive");
      localStorage.removeItem("tmux-mobile-immersive-hint-seen");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);

    const hint = page.getByTestId("immersive-hint");
    await expect(hint).toBeVisible();

    await page.getByTestId("immersive-hint-dismiss").click();
    await expect(hint).toBeHidden();

    const persisted = await page.evaluate(() =>
      localStorage.getItem("tmux-mobile-immersive-hint-seen")
    );
    expect(persisted).toBe("true");

    await page.reload();
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.getByTestId("immersive-hint")).toBeHidden();
  });

  test("first-run hint never shows on a desktop viewport", async ({ browser }) => {
    const desktop = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      hasTouch: false,
      isMobile: false
    });
    try {
      const page = await desktop.newPage();
      await page.addInitScript(() => {
        localStorage.removeItem("tmux-mobile-immersive");
        localStorage.removeItem("tmux-mobile-immersive-hint-seen");
      });
      await page.goto(`${server.baseUrl}/?token=${server.token}`);
      await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
      await expect(page.getByTestId("immersive-hint")).toBeHidden();
    } finally {
      await desktop.close();
    }
  });

  test("tapping the terminal hides chrome and reveals the immersive controls", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tmux-mobile-immersive");
      localStorage.removeItem("tmux-mobile-immersive-hint-seen");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.locator(".topbar")).toBeVisible();

    await page.getByTestId("terminal-host").click();
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");
    await expect(page.locator(".topbar")).toBeHidden();
    await expect(page.locator(".toolbar")).toBeHidden();
    await expect(page.getByTestId("immersive-close")).toBeVisible();
    await expect(page.getByTestId("immersive-handle")).toBeVisible();
  });

  test("clicking the bottom handle restores chrome", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tmux-mobile-immersive", "true");
      localStorage.setItem("tmux-mobile-immersive-hint-seen", "true");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");

    await page.getByTestId("immersive-handle").click();
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "false");
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test("PTY output renders while chrome is hidden", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tmux-mobile-immersive", "true");
      localStorage.setItem("tmux-mobile-immersive-hint-seen", "true");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");

    await expect.poll(() => server.ptyFactory.processes.length).toBeGreaterThan(0);
    server.ptyFactory.latestProcess().emitData("IMMERSIVE_LIVE_TOKEN\r\n");

    await expect
      .poll(async () => {
        const screen = await page.evaluate(() => {
          const rows = document.querySelectorAll(
            '.terminal-host .xterm-rows > div'
          );
          return Array.from(rows).map((row) => row.textContent ?? "").join("\n");
        });
        return screen.includes("IMMERSIVE_LIVE_TOKEN");
      })
      .toBe(true);
  });

  test("hide transition emits exactly one new PTY resize and adds rows", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tmux-mobile-immersive");
      localStorage.setItem("tmux-mobile-immersive-hint-seen", "true");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);

    await expect.poll(() => server.ptyFactory.processes.length).toBeGreaterThan(0);
    await expect.poll(() => server.ptyFactory.latestProcess().resizes.length).toBeGreaterThan(0);
    const resizesBefore = server.ptyFactory.latestProcess().resizes.length;
    const rowsBefore = server.ptyFactory.latestProcess().resizes.at(-1)?.rows ?? 0;

    await page.getByTestId("terminal-host").click();
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");

    await expect
      .poll(() => server.ptyFactory.latestProcess().resizes.length)
      .toBe(resizesBefore + 1);
    const rowsAfter = server.ptyFactory.latestProcess().resizes.at(-1)?.rows ?? 0;
    expect(rowsAfter).toBeGreaterThan(rowsBefore);
  });

  test("state persists across reload", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tmux-mobile-immersive");
      localStorage.setItem("tmux-mobile-immersive-hint-seen", "true");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);

    await page.getByTestId("terminal-host").click();
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");

    const stored = await page.evaluate(() =>
      localStorage.getItem("tmux-mobile-immersive")
    );
    expect(stored).toBe("true");

    // Override the addInitScript for the reload so the immersive value we
    // just persisted is preserved instead of being wiped again.
    await page.addInitScript(() => {
      localStorage.setItem("tmux-mobile-immersive", "true");
    });
    await page.reload();
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");
  });

  test("tapping the top-left close button restores chrome", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tmux-mobile-immersive", "true");
      localStorage.setItem("tmux-mobile-immersive-hint-seen", "true");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");

    const close = page.getByTestId("immersive-close");
    await expect(close).toBeVisible();
    await close.click();
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "false");
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test("no swipe-up gesture: swiping from the terminal does not exit immersive", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tmux-mobile-immersive", "true");
      localStorage.setItem("tmux-mobile-immersive-hint-seen", "true");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");

    // Synthesize an upward swipe on the terminal area. The spec's swipe-up
    // gesture was intentionally removed in favor of an explicit close
    // button, so this gesture MUST NOT change immersive state.
    const target = page.getByTestId("terminal-host");
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    const startX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const startY = (box?.y ?? 0) + (box?.height ?? 0) - 80;
    const endY = startY - 80;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY, id: 1 }]
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX, y: endY, id: 1 }]
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: []
    });

    await page.waitForTimeout(300);
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");
  });

  test("two taps on a visible terminal only resize once", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tmux-mobile-immersive");
      localStorage.setItem("tmux-mobile-immersive-hint-seen", "true");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);

    await expect.poll(() => server.ptyFactory.processes.length).toBeGreaterThan(0);
    await expect.poll(() => server.ptyFactory.latestProcess().resizes.length).toBeGreaterThan(0);
    const resizesBefore = server.ptyFactory.latestProcess().resizes.length;

    const host = page.getByTestId("terminal-host");
    await host.click();
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");

    // Second tap while immersive: stopPropagation protects xterm from stray
    // taps but should NOT toggle the state.
    await host.click();
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");

    await expect
      .poll(() => server.ptyFactory.latestProcess().resizes.length)
      .toBe(resizesBefore + 1);
  });

  test("pressing Space on the focused close button restores chrome", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tmux-mobile-immersive", "true");
      localStorage.setItem("tmux-mobile-immersive-hint-seen", "true");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");

    const close = page.getByTestId("immersive-close");
    await close.focus();
    await page.keyboard.press(" ");
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "false");
  });

  test("bottom handle is still keyboard-activatable when explicitly focused", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tmux-mobile-immersive", "true");
      localStorage.setItem("tmux-mobile-immersive-hint-seen", "true");
    });
    await page.goto(`${server.baseUrl}/?token=${server.token}`);
    await expect(page.getByTestId("top-status-indicator")).toHaveClass(/ok/);
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "true");

    // The handle is no longer the auto-focus target, but it remains a
    // keyboard-activatable close affordance for users who tab past the ×.
    const handle = page.getByTestId("immersive-handle");
    await handle.focus();
    await page.keyboard.press(" ");
    await expect(page.locator("body")).toHaveAttribute("data-immersive", "false");
  });
});
