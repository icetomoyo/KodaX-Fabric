import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employees, enterprises, teamMembers, teams, tickets } from "../../db/schema/index.js";
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

export type AdminTicketListInput = {
  limit: number;
  offset: number;
  q?: string;
  enterpriseId?: number;
  includeEmployee: boolean;
};

function ticketSearchCondition(input: Pick<AdminTicketListInput, "q" | "includeEmployee">) {
  if (!input.q) return undefined;
  const pattern = `%${input.q}%`;
  if (input.includeEmployee) {
    return or(
      ilike(tickets.ticketNo, pattern),
      ilike(tickets.subject, pattern),
      ilike(employees.name, pattern),
    );
  }
  return or(
    ilike(tickets.ticketNo, pattern),
    ilike(tickets.subject, pattern),
    ilike(enterprises.name, pattern),
  );
}

function ticketListWhere(input: AdminTicketListInput) {
  const conditions: SQL[] = [];
  if (input.enterpriseId != null) {
    conditions.push(eq(employees.enterpriseId, input.enterpriseId));
  }
  const search = ticketSearchCondition(input);
  if (search) conditions.push(search);
  return conditions.length ? and(...conditions) : undefined;
}

export function buildAdminTicketListQuery(input: AdminTicketListInput) {
  const whereExpr = ticketListWhere(input);
  if (input.includeEmployee) {
    return db
      .select({
        id: tickets.id,
        ticketNo: tickets.ticketNo,
        subject: tickets.subject,
        enterpriseName: enterprises.name,
        teamName: teams.name,
        employeeId: tickets.employeeId,
        employeeName: employees.name,
        employeeDept: employees.dept,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .innerJoin(employees, eq(tickets.employeeId, employees.id))
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .leftJoin(teamMembers, eq(teamMembers.employeeId, employees.id))
      .leftJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(whereExpr)
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .limit(input.limit)
      .offset(input.offset);
  }
  return db
    .select({
      id: tickets.id,
      ticketNo: tickets.ticketNo,
      subject: tickets.subject,
      enterpriseName: enterprises.name,
      teamName: teams.name,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .innerJoin(employees, eq(tickets.employeeId, employees.id))
    .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
    .leftJoin(teamMembers, eq(teamMembers.employeeId, employees.id))
    .leftJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(whereExpr)
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(input.limit)
    .offset(input.offset);
}

export async function adminTicketRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "org_admin"));

  function listInput(
    req: { session?: { role: string; enterpriseId: number | null } },
    parsed: z.infer<typeof adminTicketListSchema>,
  ): AdminTicketListInput | { forbidden: true } {
    if (req.session?.role === "org_admin") {
      if (req.session.enterpriseId == null) return { forbidden: true };
      return {
        ...parsed,
        enterpriseId: req.session.enterpriseId,
        includeEmployee: true,
      };
    }
    return { ...parsed, includeEmployee: false };
  }

  app.get("/api/admin/tickets", async (req, reply) => {
    const parsed = adminTicketListSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "查询参数无效" });
    }
    const input = listInput(req, parsed.data);
    if ("forbidden" in input) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }

    const whereExpr = ticketListWhere(input);
    const [[countRow], items] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(tickets)
        .innerJoin(employees, eq(tickets.employeeId, employees.id))
        .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
        .where(whereExpr),
      buildAdminTicketListQuery(input),
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

    const includeEmployee = req.session?.role === "org_admin";
    if (includeEmployee && req.session?.enterpriseId == null) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }

    const [ticket] = includeEmployee
      ? await db
          .select({
            id: tickets.id,
            ticketNo: tickets.ticketNo,
            subject: tickets.subject,
            content: tickets.content,
            enterpriseName: enterprises.name,
            teamName: teams.name,
            employeeId: tickets.employeeId,
            employeeName: employees.name,
            employeePhone: employees.phone,
            employeeDept: employees.dept,
            createdAt: tickets.createdAt,
          })
          .from(tickets)
          .innerJoin(employees, eq(tickets.employeeId, employees.id))
          .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
          .leftJoin(teamMembers, eq(teamMembers.employeeId, employees.id))
          .leftJoin(teams, eq(teamMembers.teamId, teams.id))
          .where(
            and(
              eq(tickets.id, parsed.data.id),
              eq(employees.enterpriseId, req.session!.enterpriseId!),
            ),
          )
          .limit(1)
      : await db
          .select({
            id: tickets.id,
            ticketNo: tickets.ticketNo,
            subject: tickets.subject,
            content: tickets.content,
            enterpriseName: enterprises.name,
            teamName: teams.name,
            createdAt: tickets.createdAt,
          })
          .from(tickets)
          .innerJoin(employees, eq(tickets.employeeId, employees.id))
          .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
          .leftJoin(teamMembers, eq(teamMembers.employeeId, employees.id))
          .leftJoin(teams, eq(teamMembers.teamId, teams.id))
          .where(eq(tickets.id, parsed.data.id))
          .limit(1);

    if (!ticket) {
      return reply.code(404).send({ success: false, message: "工单不存在" });
    }
    return { success: true, data: ticket };
  });
}
