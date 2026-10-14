import { api } from "./api";
import type { Cover } from "../worker/types";
export type PublicCover = Omit<Cover, "object_key" | "sha256">;
export const coverPreview = (id: string) =>
  `/api/covers/${encodeURIComponent(id)}/preview`;
export async function uploadCover(file: File): Promise<string> {
  if (
    !/\.(jpe?g|png)$/i.test(file.name) ||
    !["image/jpeg", "image/png"].includes(file.type) ||
    file.size > 8_000_000 ||
    !file.size
  )
    throw new Error("Choose a JPG or PNG up to 8 MB.");
  const header = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  if (
    !(header[0] === 255 && header[1] === 216) &&
    !(
      header[0] === 137 &&
      new TextDecoder().decode(header.slice(1, 4)) === "PNG"
    )
  )
    throw new Error("The file content is not JPG or PNG.");
  const url = URL.createObjectURL(file);
  let image: HTMLImageElement;
  try {
    image = new Image();
    image.src = url;
    await image.decode();
    if (
      image.naturalWidth < 320 ||
      image.naturalHeight < 320 ||
      image.naturalWidth * image.naturalHeight > 16_777_216
    )
      throw new Error(
        "Use an image at least 320 × 320 pixels, up to 16 megapixels.",
      );
    const scale = Math.min(
      1,
      1080 / image.naturalWidth,
      1920 / image.naturalHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    if (canvas.width < 320 || canvas.height < 320)
      throw new Error(
        "The image is too narrow. Use a 9:16 cover, ideally 1080 × 1920.",
      );
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("This browser cannot prepare the cover image.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error("Could not convert the image to JPEG.")),
        "image/jpeg",
        0.88,
      ),
    );
    if (blob.size > 2_000_000)
      throw new Error(
        "Prepared cover exceeds 2 MB. Compress the image and try again.",
      );
    const reservation = await api<{ id: string; url: string }>(
      "/covers",
      "POST",
      { name: file.name, size_bytes: blob.size },
    );
    const response = await fetch(reservation.url, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    if (!response.ok)
      throw new Error(
        `Cover transfer failed (HTTP ${response.status}). Retry or discard the pending cover.`,
      );
    const result = await api<{ id: string }>(
      `/covers/${reservation.id}/complete`,
      "POST",
      {},
    );
    return result.id;
  } finally {
    URL.revokeObjectURL(url);
  }
}
