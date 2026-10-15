import type { Settings, Video } from "./types";
export function selectNext(
  videos: Video[],
  s: Settings,
  now: number,
): Video | undefined {
  const ready = videos
    .filter(
      (v) =>
        v.status === "ready" &&
        v.enabled &&
        (s.mode !== "once" || v.publish_count === 0) &&
        (v.last_published_at === null ||
          v.last_published_at + s.cooldown_minutes * 60000 <= now),
    )
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const last = videos.find((v) => v.id === s.last_video_id);
  const after = last?.position ?? s.cursor_position;
  return ready.find((v) => v.position > after) ?? ready[0];
}
export function nextSlot(scheduled: number, now: number, minutes: number) {
  const step = minutes * 60000;
  return (
    scheduled + Math.max(1, Math.floor((now - scheduled) / step) + 1) * step
  );
}
export function backoff(attempt: number, retryAfter = 0) {
  return Math.max(
    retryAfter,
    Math.min(3600000, 60000 * 2 ** Math.max(0, attempt - 1)),
  );
}
export function upcoming(
  videos: Video[],
  settings: Settings,
  now: number,
  count = 8,
) {
  if (settings.batch_enabled) {
    const rows = videos
      .filter((v) => v.enabled && v.status === "ready")
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .slice(0, settings.batch_size || 20)
      .map((v) => ({ ...v }));
    const out: Array<{
      id: string;
      name: string;
      at: number;
      batch_at?: number;
      estimated?: boolean;
    }> = [];
    let at = Math.max(now, settings.next_publish_at ?? now);
    for (let b = 0; b < 3 && rows.length; b++) {
      at = Math.max(
        at,
        ...rows.map(
          (v) => (v.last_published_at ?? 0) + settings.cooldown_minutes * 60000,
        ),
      );
      rows.forEach((v, i) => {
        const time = at + 120000 + i * 180000;
        out.push({
          id: v.id,
          name: v.name,
          at: time,
          batch_at: at,
          estimated: true,
        });
        v.last_published_at = time;
      });
      at = nextSlot(at, at + rows.length * 180000, settings.interval_minutes);
    }
    return out;
  }
  const s = { ...settings };
  const list = videos.map((v) => ({ ...v }));
  let at = Math.max(now, s.next_publish_at ?? now);
  const out = [];
  for (let i = 0; i < count; i++) {
    let v = selectNext(list, s, at);
    if (!v) {
      const dates = list
        .filter(
          (v) =>
            v.enabled &&
            v.status === "ready" &&
            (s.mode !== "once" || v.publish_count === 0),
        )
        .map((v) => (v.last_published_at ?? 0) + s.cooldown_minutes * 60000)
        .filter((t) => t > at);
      if (!dates.length) break;
      at = Math.min(...dates);
      v = selectNext(list, s, at);
    }
    if (!v) break;
    out.push({ id: v.id, name: v.name, at });
    v.last_published_at = at;
    v.publish_count++;
    s.last_video_id = v.id;
    s.cursor_position = v.position;
    at += s.interval_minutes * 60000;
  }
  return out;
}
