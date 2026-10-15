import { z } from "zod";
export const uploadSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    content_type: z.enum(["video/mp4", "video/quicktime"]),
    size_bytes: z.number().int().positive().max(1_000_000_000),
    duration_seconds: z.number().min(3).max(900),
    width: z.number().int().min(320).max(1920),
    height: z.number().int().min(320).max(3840),
  })
  .superRefine((v, c) => {
    if (!/\.(mp4|mov)$/i.test(v.name))
      c.addIssue({ code: "custom", message: "Use an MP4 or MOV file." });
    if (v.width / v.height < 0.1 || v.width / v.height > 10)
      c.addIssue({ code: "custom", message: "Unsupported aspect ratio." });
  });
export const settingsSchema = z.object({
  interval_minutes: z.number().int().min(60).max(10080),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Invalid timezone"),
  mode: z.enum(["loop", "once", "batch"]),
  batch_size: z.number().int().min(0).max(20).default(0),
  cooldown_minutes: z.number().int().min(0).max(525600),
});
export const captionText = z
  .string()
  .refine(
    (v) => [...v].length <= 2200,
    "Caption and hashtags must total at most 2,200 characters.",
  )
  .refine(
    (v) => (v.match(/#[\p{L}\p{N}_]+/gu) || []).length <= 30,
    "At most 30 hashtags across the full caption.",
  )
  .refine(
    (v) => (v.match(/@[\p{L}\p{N}_.]+/gu) || []).length <= 20,
    "At most 20 mentions across the full caption.",
  );
export const videoSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    caption: z.string().max(8800),
    hashtags: z
      .string()
      .max(1000)
      .refine(
        (v) =>
          !v.trim() ||
          v
            .trim()
            .split(/\s+/)
            .every((x) => /^#[\p{L}\p{N}_]+$/u.test(x)),
        "Use space-separated hashtags.",
      ),
    enabled: z.boolean(),
    caption_mode: z.enum(["keep", "default", "override"]).default("keep"),
  })
  .superRefine((v, ctx) => {
    const result = captionText.safeParse(
      [v.caption, v.hashtags].filter(Boolean).join("\n\n"),
    );
    if (!result.success)
      result.error.issues.forEach((i) =>
        ctx.addIssue({ code: "custom", message: i.message }),
      );
  });
