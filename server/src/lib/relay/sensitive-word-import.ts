import { createRequire } from "node:module";
import { extname } from "node:path";
import { uniqueWords } from "./sensitive-words.js";

const require = createRequire(import.meta.url);
// exceljs 替代 xlsx@0.18.5（npm 版停更且有已知原型污染/ReDoS CVE，扫描器持续报警）
const ExcelJS = require("exceljs") as {
  Workbook: new () => {
    xlsx: { load: (data: Buffer) => Promise<void> };
    worksheets: Array<{
      eachRow: (
        options: { includeEmpty: false },
        onRow: (
          row: { getCell: (col: number) => { value: unknown } },
          rowNumber: number,
        ) => void,
      ) => void;
    }>;
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
  if (ext === ".xlsx") {
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
  if (ext === ".xls") {
    throw new Error("请使用 .xlsx 格式的表格");
  }
  throw new Error("仅支持 txt、md、xlsx、docx、pdf");
}

async function extractWordsFromSpreadsheet(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const raw: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const value = row.getCell(1).value;
    const text = value == null ? "" : String(value).trim();
    if (!text) return;
    if (rowNumber === 1 && HEADER_CELL.test(text)) return;
    raw.push(text);
  });
  return uniqueWords(raw);
}
