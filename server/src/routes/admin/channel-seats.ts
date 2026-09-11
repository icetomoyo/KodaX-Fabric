import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  channelSeats,
  employees,
  enterprises,
  opsAuditLogs,
  productLines,
  providers,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { isEmployeeSubmittedCredentialMeta } from "../../lib/channel-credential-submit.js";
import {
  normalizeSeatTag,
  planBulkChannelSeats,
  planChannelSeatCreate,
  planSeatCapacity,
  SEAT_BULK_MAX,
  SEAT_CHANNEL_FULL_MESSAGE,
  SEAT_CONFLICT_MESSAGE,
  seatCreateError,
} from "../../lib/channel-seats.js";
import { requirePasswordChanged, requireRoles, requireSession } from "../../middleware/auth.js";

type SeatTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function attachUnlinkedSubmittedCredential(
  tx: SeatTx,
  employeeId: number,
  productLineId: number,
): Promise<number | null> {
  const submitted = await tx
    .select({
      id: upstreamCredentials.id,
      meta: upstreamCredentials.meta,
    })
    .from(upstreamCredentials)
    .where(eq(upstreamCredentials.productLineId, productLineId));
  const linked = await tx
    .select({ credentialId: channelSeats.credentialId })
    .from(channelSeats)
    .where(eq(channelSeats.productLineId, productLineId));
  const linkedIds = new Set(
    linked
      .map((row) => row.credentialId)
      .filter((id): id is number => id != null),
  );
  const attached = submitted.find((row) =>
    isEmployeeSubmittedCredentialMeta(row.meta, employeeId) && !linkedIds.has(row.id),
  );
  return attached?.id ?? null;
}

async function insertSeat(
  tx: SeatTx,
  input: {
    employeeId: number;
    productLineId: number;
    tag: string;
    actorEmployeeId: number | null;
    ip: string;
  },
) {
  const credentialId = await attachUnlinkedSubmittedCredential(
    tx,
    input.employeeId,
    input.productLineId,
  );
  const [seat] = await tx
    .insert(channelSeats)
    .values({
      employeeId: input.employeeId,
      productLineId: input.productLineId,
      tag: input.tag,
      credentialId,
    })
    .returning({
      id: channelSeats.id,
      employeeId: channelSeats.employeeId,
      productLineId: channelSeats.productLineId,
      tag: channelSeats.tag,
      credentialId: channelSeats.credentialId,
    });
  await tx.insert(opsAuditLogs).values({
    actorEmployeeId: input.actorEmployeeId,
    action: "channel_seat.create",
    targetType: "channel_seat",
    targetId: String(seat.id),
    detail: {
      employeeId: seat.employeeId,
      productLineId: seat.productLineId,
      tag: seat.tag,
      credentialId: seat.credentialId,
    },
    ip: input.ip,
  });
  return seat;
}

export async function adminChannelSeatRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get(
    "/api/admin/channel-seats",
    async () => {
      const rows = await db
        .select({
          id: channelSeats.id,
          employeeId: channelSeats.employeeId,
          employeeName: employees.name,
          employeePhone: employees.phone,
          enterpriseId: employees.enterpriseId,
          enterpriseName: enterprises.name,
          productLineId: channelSeats.productLineId,
          channelName: productLines.name,
          providerName: providers.name,
          tag: channelSeats.tag,
          credentialId: channelSeats.credentialId,
          secretSuffix: upstreamCredentials.secretSuffix,
          createdAt: channelSeats.createdAt,
        })
        .from(channelSeats)
        .innerJoin(employees, eq(channelSeats.employeeId, employees.id))
        .innerJoin(productLines, eq(channelSeats.productLineId, productLines.id))
        .innerJoin(providers, eq(productLines.providerId, providers.id))
        .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
        .leftJoin(upstreamCredentials, eq(channelSeats.credentialId, upstreamCredentials.id))
        .orderBy(desc(channelSeats.id));

      return { success: true, data: rows };
    },
  );

  app.post(
    "/api/admin/channel-seats",
    async (req, reply) => {
      const body = z
        .object({
          employeeId: z.number().int().positive(),
          productLineId: z.number().int().positive(),
          tag: z.string().optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ success: false, message: "请选择员工和渠道" });
      }
      const tag = normalizeSeatTag(body.data.tag);
      if (tag == null) {
        const error = seatCreateError("tag_invalid");
        return reply.code(error.status).send({ success: false, message: error.message });
      }

      const result = await db.transaction(async (tx) => {
        const [employee] = await tx
          .select({ id: employees.id, role: employees.role })
          .from(employees)
          .where(eq(employees.id, body.data.employeeId))
          .limit(1);
        const [channel] = await tx
          .select({ id: productLines.id, seatCount: productLines.seatCount })
          .from(productLines)
          .where(eq(productLines.id, body.data.productLineId))
          .limit(1);
        const [existing] = await tx
          .select({ id: channelSeats.id })
          .from(channelSeats)
          .where(
            and(
              eq(channelSeats.employeeId, body.data.employeeId),
              eq(channelSeats.productLineId, body.data.productLineId),
              eq(channelSeats.tag, tag),
            ),
          )
          .limit(1);

        const plan = planChannelSeatCreate({
          employeeExists: Boolean(employee),
          employeeRole: employee?.role ?? null,
          channelExists: Boolean(channel),
          alreadySeated: Boolean(existing),
        });
        if (plan.kind !== "accepted") return plan;

        const [registered] = await tx
          .select({ n: count() })
          .from(channelSeats)
          .where(eq(channelSeats.productLineId, body.data.productLineId));
        const capacity = planSeatCapacity({
          seatCount: channel?.seatCount ?? 0,
          registered: Number(registered?.n ?? 0),
          adding: 1,
        });
        if (capacity.kind === "full") return { kind: "full" as const, remaining: capacity.remaining };

        const seat = await insertSeat(tx, {
          employeeId: body.data.employeeId,
          productLineId: body.data.productLineId,
          tag,
          actorEmployeeId: req.employeeId ?? null,
          ip: req.ip,
        });
        return { kind: "created" as const, seat };
      });

      if (result.kind === "full") {
        return reply.code(409).send({
          success: false,
          message: result.remaining === 0
            ? SEAT_CHANNEL_FULL_MESSAGE
            : `${SEAT_CHANNEL_FULL_MESSAGE}，还可登记 ${result.remaining} 个`,
        });
      }
      if (result.kind !== "created") {
        const error = seatCreateError(result.kind);
        return reply.code(error.status).send({ success: false, message: error.message });
      }
      return { success: true, data: result.seat };
    },
  );

  app.post(
    "/api/admin/channel-seats/bulk",
    async (req, reply) => {
      const body = z
        .object({
          productLineId: z.number().int().positive(),
          people: z
            .array(
              z.object({
                name: z.string().trim().min(1).max(100),
                phone: z.string().trim().min(5).max(20),
              }),
            )
            .min(1)
            .max(SEAT_BULK_MAX),
        })
        .safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ success: false, message: "请选择渠道并粘贴姓名和手机号" });
      }

      const result = await db.transaction(async (tx) => {
        const [channel] = await tx
          .select({ id: productLines.id, seatCount: productLines.seatCount })
          .from(productLines)
          .where(eq(productLines.id, body.data.productLineId))
          .limit(1);
        if (!channel) return { kind: "channel_missing" as const };
        const [registered] = await tx
          .select({ n: count() })
          .from(channelSeats)
          .where(eq(channelSeats.productLineId, body.data.productLineId));
        let remaining = planSeatCapacity({
          seatCount: channel.seatCount,
          registered: Number(registered?.n ?? 0),
          adding: 0,
        }).remaining;

        const phones = [...new Set(body.data.people.map((person) => person.phone.trim()))];
        const employeeRows = phones.length
          ? await tx
            .select({
              id: employees.id,
              name: employees.name,
              phone: employees.phone,
              role: employees.role,
              status: employees.status,
            })
            .from(employees)
            .where(inArray(employees.phone, phones))
          : [];
        const employeesByPhone = new Map(
          employeeRows.map((row) => [row.phone, row]),
        );
        const existing = await tx
          .select({ employeeId: channelSeats.employeeId })
          .from(channelSeats)
          .where(
            and(
              eq(channelSeats.productLineId, body.data.productLineId),
              eq(channelSeats.tag, ""),
            ),
          );
        const plan = planBulkChannelSeats({
          people: body.data.people,
          employeesByPhone,
          seatedEmployeeIds: new Set(existing.map((row) => row.employeeId)),
        });

        const created = [];
        const skipped = [];
        const failed = [];
        const seated = new Set(existing.map((row) => row.employeeId));
        for (const item of plan) {
          if (item.kind === "skip") {
            skipped.push(item);
            continue;
          }
          if (item.kind === "fail") {
            failed.push(item);
            continue;
          }
          if (seated.has(item.employeeId)) {
            skipped.push({
              kind: "skip" as const,
              name: item.name,
              phone: item.phone,
              reason: "duplicate" as const,
              message: SEAT_CONFLICT_MESSAGE,
            });
            continue;
          }
          if (Number.isFinite(remaining) && remaining <= 0) {
            failed.push({
              kind: "fail" as const,
              name: item.name,
              phone: item.phone,
              reason: "full" as const,
              message: SEAT_CHANNEL_FULL_MESSAGE,
            });
            continue;
          }
          const seat = await insertSeat(tx, {
            employeeId: item.employeeId,
            productLineId: body.data.productLineId,
            tag: "",
            actorEmployeeId: req.employeeId ?? null,
            ip: req.ip,
          });
          seated.add(item.employeeId);
          created.push(seat);
          if (Number.isFinite(remaining)) remaining -= 1;
        }

        await tx.insert(opsAuditLogs).values({
          actorEmployeeId: req.employeeId ?? null,
          action: "channel_seat.bulk_create",
          targetType: "product_line",
          targetId: String(body.data.productLineId),
          detail: {
            productLineId: body.data.productLineId,
            created: created.length,
            skipped: skipped.length,
            failed: failed.length,
          },
          ip: req.ip,
        });

        return { kind: "created" as const, created, skipped, failed };
      });

      if (result.kind === "channel_missing") {
        const error = seatCreateError("channel_missing");
        return reply.code(error.status).send({ success: false, message: error.message });
      }
      return {
        success: true,
        data: {
          created: result.created,
          skipped: result.skipped,
          failed: result.failed,
        },
      };
    },
  );

  app.delete(
    "/api/admin/channel-seats/:id",
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const deleted = await db.transaction(async (tx) => {
        const [seat] = await tx
          .select({
            id: channelSeats.id,
            credentialId: channelSeats.credentialId,
            employeeId: channelSeats.employeeId,
            productLineId: channelSeats.productLineId,
            tag: channelSeats.tag,
          })
          .from(channelSeats)
          .where(eq(channelSeats.id, params.data.id))
          .limit(1)
          .for("update");
        if (!seat) return null;
        if (seat.credentialId != null) {
          await tx.delete(upstreamCredentials).where(eq(upstreamCredentials.id, seat.credentialId));
        }
        await tx.delete(channelSeats).where(eq(channelSeats.id, seat.id));
        await tx.insert(opsAuditLogs).values({
          actorEmployeeId: req.employeeId ?? null,
          action: "channel_seat.delete",
          targetType: "channel_seat",
          targetId: String(seat.id),
          detail: {
            employeeId: seat.employeeId,
            productLineId: seat.productLineId,
            tag: seat.tag,
            credentialId: seat.credentialId,
            credentialDestroyed: seat.credentialId != null,
          },
          ip: req.ip,
        });
        return seat;
      });

      if (!deleted) {
        return reply.code(404).send({ success: false, message: "席位不存在" });
      }
      return { success: true, data: { id: deleted.id, credentialDestroyed: deleted.credentialId != null } };
    },
  );
}
