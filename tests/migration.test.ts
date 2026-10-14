import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
it("adds bulk settings to an existing database without changing captions, jobs or pause state", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: { DB: "migration-test" },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    const apply = async (name: string) =>
      db.batch(
        readFileSync(`migrations/${name}`, "utf8")
          .replace(/^\uFEFF/, "")
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => db.prepare(s)),
      );
    await apply("0001_initial.sql");
    await db
      .prepare(
        "INSERT INTO videos(id,object_key,name,content_type,size_bytes,duration_seconds,width,height,caption,hashtags,position,status,created_at) VALUES('old','videos/old','Existing','video/mp4',32,5,1080,1920,'Original','#keep',0,'ready',1)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO jobs(id,video_id,video_name,object_key,caption,scheduled_at,created_at,state,manual,media_expires_at,account_id,position) VALUES('pending','old','Existing','videos/old','Immutable caption',1,1,'queued',1,9999999999999,'123',0)",
      )
      .run();
    await apply("0002_bulk_reel_settings.sql");
    const video = await db
      .prepare("SELECT caption,hashtags,caption_override,cover_id FROM videos")
      .first();
    expect(video).toEqual({
      caption: "Original",
      hashtags: "#keep",
      caption_override: 1,
      cover_id: null,
    });
    expect(
      await db.prepare("SELECT state,caption,cover_id FROM jobs").first(),
    ).toEqual({
      state: "queued",
      caption: "Immutable caption",
      cover_id: null,
    });
    expect(
      await db
        .prepare(
          "SELECT enabled,default_caption,default_cover_id FROM settings",
        )
        .first(),
    ).toEqual({ enabled: 0, default_caption: "", default_cover_id: null });
  } finally {
    await mf.dispose();
  }
});
