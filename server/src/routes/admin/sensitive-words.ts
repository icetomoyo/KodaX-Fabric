import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  departments,
  employees,
  enterprises,
  sensitiveWordHits,
  teams,
} from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { REQUEST_CONTEXT_ID_PATTERN } from "../../lib/relay/request-context.js";
import {
  MAX_SENSITIVE_WORD_IMPORT_BYTES,
  parseSensitiveWordFile,
} from "../../lib/relay/sensitive-word-import.js";
import {
  addSensitiveWord,
  addSensitiveWords,
  listSensitiveWords,
  removeSensitiveWord,
  setSensitiveWordsEnabled,
  SensitiveWordsError,
} from "../../lib/relay/sensitive-words.js";
import { requireRoles, requireSession } from "../../middleware/auth.js";

export async function adminSensitiveWordRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/sensitive-words", async (req, reply) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(10),
        offset: z.coerce.number().min(0).default(0),
        sort: z.enum(["hitCount", "word"]).default("hitCount"),
        order: z.enum(["asc", "desc"]).default("desc"),
      })
      .safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const data = await listSensitiveWords(query.data);
    return { success: true, data };
  });

  app.post("/api/admin/sensitive-words", async (req, reply) => {
    const body = z
      .object({
        word: z.string().trim().min(1).max(64),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "敏感词不能为空" });
    }
    try {
      const data = await addSensitiveWord(body.data.word);
      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "sensitive_words.add",
        targetType: "sensitive_word",
        targetId: body.data.word.trim(),
        detail: { word: body.data.word.trim() },
        ip: req.ip,
      });
      return { success: true, data };
    } catch (error) {
      if (error instanceof SensitiveWordsError) {
        return reply.code(error.status).send({ success: false, message: error.message });
      }
      throw error;
    }
  });

  app.post("/api/admin/sensitive-words/import", async (req, reply) => {
    const body = z
      .union([
        z.object({ words: z.array(z.string()).min(1).max(10_000) }),
        z.object({
          filename: z.string().trim().min(1).max(200),
          contentBase64: z.string().min(1),
        }),
      ])
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "请上传词库文档" });
    }
    try {
      let incoming: string[];
      if ("words" in body.data) {
        incoming = body.data.words;
      } else {
        const buffer = Buffer.from(body.data.contentBase64, "base64");
        if (!buffer.length) {
          return reply.code(400).send({ success: false, message: "文档是空的" });
        }
        if (buffer.length > MAX_SENSITIVE_WORD_IMPORT_BYTES) {
          return reply.code(400).send({ success: false, message: "文档不能超过 5 MB" });
        }
        incoming = await parseSensitiveWordFile(body.data.filename, buffer);
      }
      const data = await addSensitiveWords(incoming);
      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "sensitive_words.import",
        targetType: "sensitive_word",
        targetId: "import",
        detail: { added: data.added, skipped: data.skipped },
        ip: req.ip,
      });
      return { success: true, data };
    } catch (error) {
      if (error instanceof SensitiveWordsError) {
        return reply.code(error.status).send({ success: false, message: error.message });
      }
      const message = error instanceof Error ? error.message : "导入失败";
      return reply.code(400).send({ success: false, message });
    }
  });

  app.patch("/api/admin/sensitive-words", async (req, reply) => {
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    try {
      const data = await setSensitiveWordsEnabled(body.data.enabled);
      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "sensitive_words.update",
        targetType: "sensitive_word",
        targetId: "config",
        detail: {
          detectEnabled: data.detectEnabled,
          interceptEnabled: data.interceptEnabled,
        },
        ip: req.ip,
      });
      return { success: true, data };
    } catch (error) {
      if (error instanceof SensitiveWordsError) {
        return reply.code(error.status).send({ success: false, message: error.message });
      }
      throw error;
    }
  });

  app.delete("/api/admin/sensitive-words", async (req, reply) => {
    const bodyWord =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as { word?: unknown }).word
        : undefined;
    const queryWord =
      req.query && typeof req.query === "object" && !Array.isArray(req.query)
        ? (req.query as { word?: unknown }).word
        : undefined;
    const parsed = z.object({ word: z.string().trim().min(1) }).safeParse({
      word: bodyWord ?? queryWord,
    });
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "敏感词不能为空" });
    }
    try {
      const data = await removeSensitiveWord(parsed.data.word);
      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "sensitive_words.delete",
        targetType: "sensitive_word",
        targetId: parsed.data.word,
        detail: { word: parsed.data.word },
        ip: req.ip,
      });
      return { success: true, data };
    } catch (error) {
      if (error instanceof SensitiveWordsError) {
        return reply.code(error.status).send({ success: false, message: error.message });
      }
      throw error;
    }
  });

  app.get("/api/admin/sensitive-word-hits", async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(10),
        offset: z.coerce.number().min(0).default(0),
        employeeId: z.coerce.number().int().positive().optional(),
        matchedWord: z.string().trim().min(1).max(64).optional(),
        action: z.enum(["detect", "intercept"]),
      })
      .parse(req.query);
    const conditions = [eq(sensitiveWordHits.action, query.action)];
    if (query.employeeId) conditions.push(eq(sensitiveWordHits.employeeId, query.employeeId));
    if (query.matchedWord) conditions.push(eq(sensitiveWordHits.matchedWord, query.matchedWord));
    const whereExpr = conditions.length ? and(...conditions) : undefined;

    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sensitiveWordHits)
      .where(whereExpr);

    const items = await db
      .select({
        id: sensitiveWordHits.id,
        requestId: sensitiveWordHits.requestId,
        employeeId: employees.id,
        employeeName: employees.name,
        employeePhone: employees.phone,
        enterpriseName: enterprises.name,
        departmentName: departments.name,
        teamName: teams.name,
        clientModel: sensitiveWordHits.clientModel,
        protocol: sensitiveWordHits.protocol,
        matchedWord: sensitiveWordHits.matchedWord,
        excerpt: sensitiveWordHits.excerpt,
        createdAt: sensitiveWordHits.createdAt,
      })
      .from(sensitiveWordHits)
      .innerJoin(employees, eq(sensitiveWordHits.employeeId, employees.id))
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .leftJoin(teams, eq(sensitiveWordHits.teamId, teams.id))
      .leftJoin(departments, eq(teams.departmentId, departments.id))
      .where(whereExpr)
      .orderBy(desc(sensitiveWordHits.createdAt), desc(sensitiveWordHits.id))
      .limit(query.limit)
      .offset(query.offset);

    return {
      success: true,
      data: {
        total: countRow?.n ?? 0,
        items,
      },
    };
  });

  app.get("/api/admin/sensitive-word-hits/:requestId", async (req, reply) => {
    const params = z
      .object({ requestId: z.string().regex(REQUEST_CONTEXT_ID_PATTERN) })
      .safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const [row] = await db
      .select({
        id: sensitiveWordHits.id,
        requestId: sensitiveWordHits.requestId,
        employeeId: employees.id,
        employeeName: employees.name,
        employeePhone: employees.phone,
        employeeDept: employees.dept,
        enterpriseName: enterprises.name,
        departmentName: departments.name,
        teamName: teams.name,
        clientModel: sensitiveWordHits.clientModel,
        protocol: sensitiveWordHits.protocol,
        path: sensitiveWordHits.path,
        matchedWord: sensitiveWordHits.matchedWord,
        excerpt: sensitiveWordHits.excerpt,
        requestPreview: sensitiveWordHits.requestPreview,
        userAgent: sensitiveWordHits.userAgent,
        ip: sensitiveWordHits.ip,
        createdAt: sensitiveWordHits.createdAt,
      })
      .from(sensitiveWordHits)
      .innerJoin(employees, eq(sensitiveWordHits.employeeId, employees.id))
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .leftJoin(teams, eq(sensitiveWordHits.teamId, teams.id))
      .leftJoin(departments, eq(teams.departmentId, departments.id))
      .where(eq(sensitiveWordHits.requestId, params.data.requestId))
      .limit(1);
    if (!row) {
      return reply.code(404).send({ success: false, message: "记录不存在" });
    }
    return { success: true, data: row };
  });
}
