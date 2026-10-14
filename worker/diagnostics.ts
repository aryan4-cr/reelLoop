import { HTTPException } from "hono/http-exception";
import { BusyError, LeaseLostError } from "./lease";

const labels = {
  oauth_session: "Instagram connection: owner session validation",
  oauth_state: "Instagram connection: OAuth state validation",
  oauth_code: "Instagram connection: authorization code exchange",
  oauth_long_token: "Instagram connection: long-lived token exchange",
  oauth_profile: "Instagram connection: account validation",
  oauth_encryption: "Instagram connection: token encryption",
  oauth_persistence: "Instagram connection: database persistence",
  upload_multipart: "Upload: multipart completion",
  upload_verification: "Upload: staging object verification",
  upload_promotion: "Upload: permanent object promotion",
  upload_final_verification: "Upload: permanent object verification",
  upload_persistence: "Upload: database finalization",
} as const;
export type Stage = keyof typeof labels;
export class OperationError extends Error {
  constructor(
    readonly stage: Stage,
    readonly status: 400 | 401 | 403 | 409 | 500 | 502 | 503 = 500,
    readonly providerStatus?: number,
    readonly providerCode?: number,
    detail?: string,
  ) {
    super(
      `${labels[stage]} failed. ${
        detail ??
        (stage.startsWith("oauth_")
          ? "Return to the dashboard and start Connect Instagram again."
          : "Retry finalization from the library within 24 hours, before staging cleanup.")
      }`,
    );
  }
  diagnostic() {
    // Explicit allowlist only. Never include errors, stacks, URLs, IDs or bodies.
    return {
      stage: this.stage,
      status: this.status,
      ...(Number.isInteger(this.providerStatus)
        ? { provider_status: this.providerStatus }
        : {}),
      ...(Number.isInteger(this.providerCode)
        ? { provider_code: this.providerCode }
        : {}),
    };
  }
}
export async function atStage<T>(
  stage: Stage,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof OperationError) throw error;
    if (error instanceof BusyError || error instanceof LeaseLostError)
      throw new OperationError(stage, 409);
    if (
      error instanceof HTTPException &&
      [400, 401, 403, 409, 503].includes(error.status)
    )
      throw new OperationError(
        stage,
        error.status as 400,
        undefined,
        undefined,
        error.message,
      );
    throw new OperationError(stage);
  }
}
