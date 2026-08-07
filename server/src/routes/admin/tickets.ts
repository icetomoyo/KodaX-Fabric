import type { FastifyInstance } from "fastify";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employees, tickets } from "../../db/schema/index.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const adminTicketListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(100).optional(),
});

function ticketSearchCondition(q?: string) {
  if (!q) return undefined;
  const pattern = `%${q}%`;
  return or(
    ilike(tickets.ticketNo, pattern),
    ilike(tickets.subject, pattern),
    ilike(employees.name, pattern),
  );
}

export function buildAdminTicketListQuery(input: {
  limit: number;
  offset: number;
  q?: string;
}) {
  return db
    .select({
      id: tickets.id,
      ticketNo: tickets.ticketNo,
      subject: tickets.subject,
      employeeId: tickets.employeeId,
      employeeName: employees.name,
      employeeDept: employees.dept,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .innerJoin(employees, eq(tickets.employeeId, employees.id))
    .where(ticketSearchCondition(input.q))
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(input.limit)
    .offset(input.offset);
}

export async function adminTicketRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/tickets", async (req, reply) => {
    const parsed = adminTicketListSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "查询参数无效" });
    }

    const whereExpr = ticketSearchCondition(parsed.data.q);
    const [[countRow], items] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(tickets)
        .innerJoin(employees, eq(tickets.employeeId, employees.id))
        .where(whereExpr),
      buildAdminTicketListQuery(parsed.data),
    ]);

    return {
      success: true,
      data: { total: countRow?.total ?? 0, items },
    };
  });

  app.get("/api/admin/tickets/:id", async (req, reply) => {
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
        employeeId: tickets.employeeId,
        employeeName: employees.name,
        employeePhone: employees.phone,
        employeeDept: employees.dept,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .innerJoin(employees, eq(tickets.employeeId, employees.id))
      .where(eq(tickets.id, parsed.data.id))
      .limit(1);

    if (!ticket) {
      return reply.code(404).send({ success: false, message: "工单不存在" });
    }
    return { success: true, data: ticket };
  });
}
