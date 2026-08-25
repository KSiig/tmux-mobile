import { describe, expect, test } from "vitest";
import { resolveAuthSecrets } from "../../src/backend/auth/auth-service.js";

describe("resolveAuthSecrets", () => {
  test("uses explicit token and password over env", () => {
    const secrets = resolveAuthSecrets({
      token: "cli-token",
      password: "cli-pass",
      requirePassword: true,
      env: {
        TMUX_MOBILE_TOKEN: "env-token",
        TMUX_MOBILE_PASSWORD: "env-pass"
      }
    });
    expect(secrets).toEqual({ token: "cli-token", password: "cli-pass" });
  });

  test("falls back to env when flags are omitted", () => {
    const secrets = resolveAuthSecrets({
      requirePassword: true,
      env: {
        TMUX_MOBILE_TOKEN: "env-token",
        TMUX_MOBILE_PASSWORD: "env-pass"
      }
    });
    expect(secrets).toEqual({ token: "env-token", password: "env-pass" });
  });

  test("omits password when protection is disabled", () => {
    const secrets = resolveAuthSecrets({
      password: "ignored",
      token: "cli-token",
      requirePassword: false,
      env: { TMUX_MOBILE_PASSWORD: "env-pass" }
    });
    expect(secrets).toEqual({ token: "cli-token", password: undefined });
  });

  test("generates secrets when nothing is provided", () => {
    const secrets = resolveAuthSecrets({
      requirePassword: true,
      env: {}
    });
    expect(secrets.token.length).toBeGreaterThan(8);
    expect(secrets.password?.length).toBeGreaterThan(8);
  });
});
