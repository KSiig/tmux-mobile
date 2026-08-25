import { randomToken } from "../util/random.js";

export interface AuthPayload {
  token?: string;
  password?: string;
}

export interface AuthSecretInput {
  password?: string;
  token?: string;
  requirePassword: boolean;
  env?: NodeJS.ProcessEnv;
}

export const resolveAuthSecrets = (
  input: AuthSecretInput
): { password?: string; token: string } => {
  const env = input.env ?? process.env;
  const token = input.token || env.TMUX_MOBILE_TOKEN || randomToken();
  const password = input.requirePassword
    ? input.password || env.TMUX_MOBILE_PASSWORD || randomToken(16)
    : undefined;
  return { password, token };
};

export class AuthService {
  public readonly token: string;
  private readonly password?: string;

  public constructor(password?: string, token?: string) {
    this.password = password;
    this.token = token ?? randomToken();
  }

  public requiresPassword(): boolean {
    return Boolean(this.password);
  }

  public verify(payload: AuthPayload): { ok: boolean; reason?: string } {
    if (!payload.token || payload.token !== this.token) {
      return { ok: false, reason: "invalid token" };
    }

    if (this.password && payload.password !== this.password) {
      return { ok: false, reason: "invalid password" };
    }

    return { ok: true };
  }
}
