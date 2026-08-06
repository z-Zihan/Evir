import type { Area } from "react-easy-crop";

const AVATAR_SIZE = 256;
export const MAX_AVATAR_SOURCE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type AvatarFileError = "type" | "size" | null;

export function validateAvatarFile(file: Pick<File, "size" | "type">): AvatarFileError {
  if (!SUPPORTED_AVATAR_TYPES.has(file.type)) return "type";
  if (file.size > MAX_AVATAR_SOURCE_BYTES) return "size";
  return null;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("avatar-image-load-failed"));
    image.src = source;
  });
}

export async function cropAvatarImage(source: string, area: Area): Promise<string> {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("avatar-canvas-unavailable");
  context.fillStyle = "#f4f4f2";
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return canvas.toDataURL("image/jpeg", 0.88);
}
