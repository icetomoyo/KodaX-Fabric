import { createRequire } from "node:module";
import { extname } from "node:path";
import { uniqueWords } from "./sensitive-words.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as {
  read: (data: Buffer, opts: { type: "buffer" }) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (sheet: unknown, opts: { header: 1; raw: false }) => unknown[][];
  };
};
const mammoth = require("mammoth") as {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};
const { PDFParse } = require("pdf-parse") as {
  PDFParse: new (opts: { data: Buffer }) => {
    getText: () => Promise<{ text?: string }>;
    destroy: () => Promise<void>;
  };
};

export const MAX_SENSITIVE_WORD_IMPORT_BYTES = 5 * 1024 * 1024;
const HEADER_CELL = /^(敏感词|word|words)$/i;

export function extractWordsFromText(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const raw: string[] = [];
  for (const line of lines) {
    let value = line.trim();
    if (!value) continue;
    if (/^#{1,6}\s+/.test(value) || value === "```" || value.startsWith("```")) continue;
    value = value.replace(/^[-*+]\s+/, "");
    value = value.replace(/^\d+[.)、]\s+/, "");
    value = value.replace(/^`+|`+$/g, "").trim();
    if (!value) continue;
    raw.push(value);
  }
  return uniqueWords(raw);
}

export async function parseSensitiveWordFile(filename: string, buffer: Buffer): Promise<string[]> {
  const ext = extname(filename).toLowerCase();
  if (ext === ".txt" || ext === ".md" || ext === ".markdown") {
    return extractWordsFromText(buffer.toString("utf8"));
  }
  if (ext === ".xlsx" || ext === ".xls") {
    return extractWordsFromSpreadsheet(buffer);
  }
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return extractWordsFromText(result.value ?? "");
  }
  if (ext === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return extractWordsFromText(result.text ?? "");
    } finally {
      await parser.destroy();
    }
  }
  if (ext === ".doc") {
    throw new Error("请使用 .docx 格式的 Word 文档");
  }
  throw new Error("仅支持 txt、md、xlsx、xls、docx、pdf");
}

function extractWordsFromSpreadsheet(buffer: Buffer): string[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
  });
  const raw: string[] = [];
  rows.forEach((row, index) => {
    const cell = Array.isArray(row) ? row[0] : undefined;
    const value = cell == null ? "" : String(cell).trim();
    if (!value) return;
    if (index === 0 && HEADER_CELL.test(value)) return;
    raw.push(value);
  });
  return uniqueWords(raw);
}
