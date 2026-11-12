import { dataUrlToBase64 } from "~/_utils/dataUrl";

/** Reads a file and resolves to its base64 payload (no `data:` prefix). */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file"));
    reader.onload = () => {
      const base64 = dataUrlToBase64(reader.result);
      if (base64) resolve(base64);
      else reject(new Error("Could not read the selected file"));
    };
    reader.readAsDataURL(file);
  });
}
