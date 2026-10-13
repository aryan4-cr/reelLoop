import type { Env } from "./types";
export class MetaError extends Error {
  constructor(
    readonly code: number,
    readonly retryable: boolean,
    readonly ambiguous = false,
    readonly retryAfter = 0,
  ) {
    super(
      code === 190
        ? "Instagram authorization expired or was revoked. Reconnect your account."
        : code === 429 || code === 4 || code === 32 || code === 613
          ? "Instagram rate limit reached. Retry will be delayed."
          : `Instagram request failed (code ${code}). See Meta app configuration and account permissions.`,
    );
  }
}
export interface MetaAdapter {
  createContainer(
    account: string,
    token: string,
    url: string,
    caption: string,
  ): Promise<string>;
  status(container: string, token: string): Promise<string>;
  publish(account: string, token: string, container: string): Promise<string>;
  quota(
    account: string,
    token: string,
  ): Promise<{ used: number; total: number }>;
  refresh(token: string): Promise<{ access_token: string; expires_in: number }>;
  media(
    account: string,
    token: string,
  ): Promise<
    Array<{
      id: string;
      timestamp: string;
      permalink?: string;
      caption?: string;
    }>
  >;
}
export class Instagram implements MetaAdapter {
  constructor(
    readonly env: Env,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  async request<T>(
    path: string,
    token: string,
    method = "GET",
    params: Record<string, string> = {},
  ): Promise<T> {
    if (!/^v\d+\.0$/.test(this.env.META_API_VERSION))
      throw new Error("Configure a supported Meta API version.");
    const url = new URL(
      `https://graph.instagram.com/${this.env.META_API_VERSION}/${path}`,
    );
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    let body: URLSearchParams | undefined;
    if (method === "GET")
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    else body = new URLSearchParams(params);
    let res: Response;
    try {
      res = await this.fetcher(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new MetaError(0, true, method === "POST");
    }
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new MetaError(res.status, true, method === "POST");
    }
    if (!res.ok || data.error) {
      const err = data.error as
        { code?: number; is_transient?: boolean } | undefined;
      const code = err?.code ?? res.status;
      const retry = Number(res.headers.get("retry-after") || 0) * 1000;
      throw new MetaError(
        code,
        Boolean(err?.is_transient) ||
          res.status >= 500 ||
          [429, 4, 32, 613].includes(code),
        method === "POST" && (res.status >= 500 || !data.error),
        retry,
      );
    }
    return data as T;
  }
  async createContainer(
    account: string,
    token: string,
    url: string,
    caption: string,
  ) {
    const data = await this.request<{ id: string }>(
      `${account}/media`,
      token,
      "POST",
      { media_type: "REELS", video_url: url, caption, share_to_feed: "true" },
    );
    if (!data.id) throw new MetaError(0, true, true);
    return data.id;
  }
  async status(container: string, token: string) {
    const data = await this.request<{ status_code: string }>(
      container,
      token,
      "GET",
      { fields: "status_code" },
    );
    if (!data.status_code) throw new MetaError(0, true);
    return data.status_code;
  }
  async publish(account: string, token: string, container: string) {
    const data = await this.request<{ id: string }>(
      `${account}/media_publish`,
      token,
      "POST",
      { creation_id: container },
    );
    if (!data.id) throw new MetaError(0, false, true);
    return data.id;
  }
  async quota(account: string, token: string) {
    const data = await this.request<{
      data: Array<{ quota_usage: number; config: { quota_total: number } }>;
    }>(`${account}/content_publishing_limit`, token, "GET", {
      fields: "quota_usage,config",
    });
    const row = data.data?.[0];
    if (
      !row ||
      !Number.isFinite(row.quota_usage) ||
      !Number.isFinite(row.config?.quota_total)
    )
      throw new MetaError(0, true);
    return { used: row.quota_usage, total: row.config.quota_total };
  }
  async refresh(token: string) {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", token);
    let res: Response;
    try {
      res = await this.fetcher(url, { signal: AbortSignal.timeout(15000) });
    } catch {
      throw new MetaError(0, true);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    if (!res.ok || !data.access_token || !data.expires_in)
      throw new MetaError(190, false);
    return data;
  }
  async media(account: string, token: string) {
    const data = await this.request<{
      data: Array<{
        id: string;
        timestamp: string;
        permalink?: string;
        caption?: string;
      }>;
    }>(`${account}/media`, token, "GET", {
      fields: "id,timestamp,permalink,caption",
      limit: "100",
    });
    return data.data ?? [];
  }
  async exchange(code: string) {
    if (!this.env.META_APP_ID || !this.env.META_APP_SECRET)
      throw new Error("Instagram Login is not configured.");
    const body = new URLSearchParams({
      client_id: this.env.META_APP_ID,
      client_secret: this.env.META_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: `${this.env.PUBLIC_ORIGIN}/api/instagram/callback`,
      code,
    });
    const shortRes = await this.fetcher(
      "https://api.instagram.com/oauth/access_token",
      { method: "POST", body, signal: AbortSignal.timeout(15000) },
    );
    const short = (await shortRes.json()) as {
      access_token?: string;
      user_id?: string;
    };
    if (!shortRes.ok || !short.access_token) throw new MetaError(190, false);
    const url = new URL("https://graph.instagram.com/access_token");
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", this.env.META_APP_SECRET);
    url.searchParams.set("access_token", short.access_token);
    const longRes = await this.fetcher(url, {
      signal: AbortSignal.timeout(15000),
    });
    const long = (await longRes.json()) as {
      access_token: string;
      expires_in: number;
    };
    if (!longRes.ok || !long.access_token || !long.expires_in)
      throw new MetaError(190, false);
    const profile = await this.request<{
      id: string;
      user_id?: string;
      username: string;
    }>("me", long.access_token, "GET", { fields: "user_id,username" });
    const id = profile.user_id ?? short.user_id ?? profile.id;
    if (!id || !profile.username) throw new MetaError(190, false);
    return { ...long, id: String(id), username: profile.username };
  }
}
