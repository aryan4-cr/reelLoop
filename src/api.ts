import type { Settings, Video, Job } from "../worker/types";
export type PublicVideo = Omit<Video, "object_key" | "multipart_id">;
export type PublicJob = Omit<Job, "object_key" | "media_expires_at">;
export interface Dashboard {
  settings: Settings;
  account: {
    instagram_id: string;
    username: string;
    expires_at: number;
    status: string;
  } | null;
  videos: PublicVideo[];
  jobs: PublicJob[];
  stats: { total: number; success: number; errors: number };
  storage: { used: number; limit: number };
  upcoming: Array<{ id: string; name: string; at: number }>;
  configuration: { uploads: boolean; instagram: boolean };
}
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => {
    throw new ApiError(
      `Server returned an unreadable response (HTTP ${res.status}). Refresh the dashboard to check the operation before retrying.`,
      res.status,
    );
  })) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? "Request failed.", res.status);
  return data;
}
export const bytes = (n: number) =>
  n >= 1073741824
    ? `${(n / 1073741824).toFixed(2)} GB`
    : n >= 1048576
      ? `${(n / 1048576).toFixed(1)} MB`
      : `${Math.round(n / 1024)} KB`;
export function videoMetadata(
  file: File,
): Promise<{ duration_seconds: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video"),
      url = URL.createObjectURL(file);
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Could not read video metadata. Convert to H.264 MP4 locally.",
          ),
        ),
      15000,
    );
    function finish(error?: Error) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      v.load();
      if (error) reject(error);
    }
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (
        !Number.isFinite(v.duration) ||
        v.duration < 3 ||
        v.duration > 900 ||
        v.videoWidth > 1920
      ) {
        finish(new Error("Use a 3–900 second video, up to 1920 pixels wide."));
        return;
      }
      resolve({
        duration_seconds: v.duration,
        width: v.videoWidth,
        height: v.videoHeight,
      });
      finish();
    };
    v.onerror = () =>
      finish(
        new Error(
          "Browser cannot read this video. Convert it to H.264 MP4 locally.",
        ),
      );
    v.src = url;
  });
}
function put(
  url: string,
  blob: Blob,
  onProgress: (n: number) => void,
  type?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 20 * 60000;
    if (type) xhr.setRequestHeader("Content-Type", type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.getResponseHeader("ETag") ?? "")
        : reject(
            new Error(
              `Upload failed (${xhr.status}). Check R2 CORS and credentials.`,
            ),
          );
    xhr.onerror = () =>
      reject(
        new Error("R2 upload failed. Check bucket CORS and your connection."),
      );
    xhr.ontimeout = () =>
      reject(new Error("Upload timed out. Retry on a stable connection."));
    xhr.send(blob);
  });
}
// Keep completed part metadata for retries in this tab. Once multipart completion
// succeeds, the server can recover from staging even after a page reload.
const completedParts = new Map<
  string,
  Array<{ partNumber: number; etag: string }>
>();
export async function finalizeUpload(id: string) {
  await api(`/uploads/${id}/complete`, "POST", {
    parts: completedParts.get(id),
  });
  completedParts.delete(id);
}
export async function uploadFile(
  file: File,
  onProgress: (percent: number) => void,
) {
  if (
    !/\.(mp4|mov)$/i.test(file.name) ||
    file.size > 1_000_000_000 ||
    !file.size
  )
    throw new Error("Upload MP4/MOV files up to 1 GB.");
  const meta = await videoMetadata(file);
  const type = /\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4";
  const reservation = await api<{
    id: string;
    multipart: boolean;
    parts: number;
    part_size: number;
    url?: string;
  }>("/uploads", "POST", {
    name: file.name,
    content_type: type,
    size_bytes: file.size,
    ...meta,
  });
  let finalizing = false;
  try {
    const parts = [];
    if (reservation.multipart) {
      for (let part = 1; part <= reservation.parts; part++) {
        const start = (part - 1) * reservation.part_size;
        const blob = file.slice(
          start,
          Math.min(file.size, start + reservation.part_size),
        );
        let etag = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const { url } = await api<{ url: string }>(
              `/uploads/${reservation.id}/part`,
              "POST",
              { part },
            );
            etag = await put(url, blob, (n) =>
              onProgress(Math.floor(((start + n) / file.size) * 95)),
            );
            break;
          } catch (e) {
            if (attempt === 2) throw e;
          }
        }
        if (!etag) throw new Error("R2 CORS must expose the ETag header.");
        parts.push({ partNumber: part, etag });
      }
    } else
      await put(
        reservation.url!,
        file,
        (n) => onProgress(Math.floor((n / file.size) * 95)),
        type,
      );
    finalizing = true;
    onProgress(97);
    if (reservation.multipart) completedParts.set(reservation.id, parts);
    await finalizeUpload(reservation.id);
    onProgress(100);
  } catch (e) {
    if (finalizing) {
      throw new Error(
        `${e instanceof Error ? e.message : "Finalization failed."} The pending upload has been retained. Retry finalization in the library within 24 hours, before staging cleanup.`,
      );
    }
    try {
      await api(`/uploads/${reservation.id}`, "DELETE");
    } catch {
      /* Owner can discard this pending upload from the library. */
    }
    throw e;
  }
}
