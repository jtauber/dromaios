/** Export the current drive contents under a new filename, including on repeated exports. */
export function downloadDiskImage(name: string, extension: ".dsk" | ".img", bytes: Uint8Array): string {
  const filename = name.replace(/(?:-saved)?\.(?:dsk|do|img|ima)$/i, "") + "-saved" + extension;
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
