declare module "mammoth" {
  export function convertToHtml(
    input: { buffer: Buffer },
    options?: Record<string, unknown>,
  ): Promise<{ value: string; messages: unknown[] }>;
  const mammoth: { convertToHtml: typeof convertToHtml };
  export default mammoth;
}
declare module "sanitize-html" {
  export default function sanitizeHtml(html: string, options?: Record<string, unknown>): string;
}
declare module "yauzl" {
  type Entry = { fileName: string; compressedSize: number; uncompressedSize: number };
  type ZipFile = {
    readEntry(): void;
    close(): void;
    on(event: "entry", cb: (entry: Entry) => void): void;
    on(event: "end" | "error", cb: (error?: Error) => void): void;
  };
  const yauzl: {
    fromBuffer(
      buffer: Buffer,
      options: Record<string, unknown>,
      callback: (error: Error | null, zip?: ZipFile) => void,
    ): void;
  };
  export default yauzl;
}
