/** Utilidades de archivos y descargas, sin dependencias externas. */

export function downloadBlob(name: string, data: BlobPart, type = "application/octet-stream"): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadText(name: string, text: string, type = "text/plain;charset=utf-8"): void {
  downloadBlob(name, text, type);
}

export function downloadDataUrl(name: string, dataUrl: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadBytes(name: string, bytes: Uint8Array, type = "application/zip"): void {
  downloadBlob(name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, type);
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] || "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(new Error("No se pudo leer el archivo."));
    fr.readAsText(file);
  });
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    };
    input.oncancel = () => {
      input.remove();
      resolve([]);
    };
    input.click();
  });
}

export function safeFileName(name: string, fallback = "lasercat"): string {
  return (
    (name || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || fallback
  );
}
