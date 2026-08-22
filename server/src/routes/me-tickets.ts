import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { tickets } from "../db/schema/index.js";
import {
  TICKET_CONTENT_MAX_LENGTH,
  TICKET_SUBJECT_MAX_LENGTH,
  createTicketNumber,
} from "../lib/tickets.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../middleware/auth.js";

const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(TICKET_SUBJECT_MAX_LENGTH),
  content: z.string().trim().min(1).max(TICKET_CONTENT_MAX_LENGTH),
});

const listTicketSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

export function buildEmployeeTicketListQuery(input: {
  employeeId: number;
  limit: number;
  offset: number;
}) {
  return db
    .select({
      id: tickets.id,
      ticketNo: tickets.ticketNo,
      subject: tickets.subject,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(eq(tickets.employeeId, input.employeeId))
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(input.limit)
    .offset(input.offset);
}

export async function meTicketRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("employee", "team_admin"));

  app.post("/api/me/tickets", async (req, reply) => {
    const parsed = createTicketSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "标题或问题描述不符合要求" });
    }

    const [ticket] = await db
      .insert(tickets)
      .values({
        ticketNo: createTicketNumber(),
        employeeId: req.employeeId!,
        subject: parsed.data.subject,
        content: parsed.data.content,
      })
      .returning({
        id: tickets.id,
        ticketNo: tickets.ticketNo,
        subject: tickets.subject,
        content: tickets.content,
        createdAt: tickets.createdAt,
      });

    return reply.code(201).send({ success: true, data: ticket });
  });

  app.get("/api/me/tickets", async (req, reply) => {
    const parsed = listTicketSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "查询参数无效" });
    }

    const whereExpr = eq(tickets.employeeId, req.employeeId!);
    const [[countRow], items] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(tickets).where(whereExpr),
      buildEmployeeTicketListQuery({
        employeeId: req.employeeId!,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      }),
    ]);

    return {
      success: true,
      data: { total: countRow?.total ?? 0, items },
    };
  });

  app.get("/api/me/tickets/:id", async (req, reply) => {
    const parsed = z
      .object({ id: z.coerce.number().int().positive() })
      .safeParse(req.params);
    if (!parsed.success) {
      return reply.code(404).send({ success: false, message: "工单不存在" });
    }

    const [ticket] = await db
      .select({
        id: tickets.id,
        ticketNo: tickets.ticketNo,
        subject: tickets.subject,
        content: tickets.content,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .where(
        and(
          eq(tickets.id, parsed.data.id),
          eq(tickets.employeeId, req.employeeId!),
        ),
      )
      .limit(1);

    if (!ticket) {
      return reply.code(404).send({ success: false, message: "工单不存在" });
    }
    return { success: true, data: ticket };
  });
}
