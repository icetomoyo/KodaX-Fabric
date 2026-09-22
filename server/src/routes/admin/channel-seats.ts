import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, ne } from "drizzle-orm";
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
import {
  buildEmployeeSubmittedCredentialLabel,
  isEmployeeSubmittedCredentialMeta,
} from "../../lib/channel-credential-submit.js";
import { secretSuffix } from "../../lib/crypto-secret.js";
import {
  normalizeSeatTag,
  planChannelSeatCreate,
  planChannelSeatUpdate,
  planSeatCapacity,
  SEAT_CHANNEL_FULL_MESSAGE,
  seatCreateError,
  seatUpdateError,
} from "../../lib/channel-seats.js";
import { requireRoles, requireSession } from "../../middleware/auth.js";

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

  app.patch(
    "/api/admin/channel-seats/:id",
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
      const body = z
        .object({
          employeeId: z.number().int().positive().optional(),
          tag: z.string().optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0, {
          message: "至少提供一个要修改的字段",
        })
        .safeParse(req.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const result = await db.transaction(async (tx) => {
        const [seat] = await tx
          .select({
            id: channelSeats.id,
            employeeId: channelSeats.employeeId,
            productLineId: channelSeats.productLineId,
            tag: channelSeats.tag,
            credentialId: channelSeats.credentialId,
          })
          .from(channelSeats)
          .where(eq(channelSeats.id, params.data.id))
          .limit(1)
          .for("update");

        const nextEmployeeId = body.data.employeeId ?? seat?.employeeId ?? 0;
        const tagProvided = body.data.tag !== undefined;
        const nextTag = tagProvided ? normalizeSeatTag(body.data.tag) : (seat?.tag ?? "");
        const employeeUnchanged = Boolean(seat) && nextEmployeeId === seat!.employeeId;
        let employeeExists = employeeUnchanged;
        let employeeName: string | null = null;
        if (!employeeUnchanged && nextEmployeeId > 0) {
          const [employee] = await tx
            .select({ id: employees.id, name: employees.name })
            .from(employees)
            .where(eq(employees.id, nextEmployeeId))
            .limit(1);
          employeeExists = Boolean(employee);
          employeeName = employee?.name ?? null;
        }

        let alreadySeated = false;
        if (seat && nextTag != null) {
          const [conflict] = await tx
            .select({ id: channelSeats.id })
            .from(channelSeats)
            .where(
              and(
                eq(channelSeats.employeeId, nextEmployeeId),
                eq(channelSeats.productLineId, seat.productLineId),
                eq(channelSeats.tag, nextTag),
                ne(channelSeats.id, seat.id),
              ),
            )
            .limit(1);
          alreadySeated = Boolean(conflict);
        }

        const plan = planChannelSeatUpdate({
          seatExists: Boolean(seat),
          employeeExists,
          alreadySeated,
          nextEmployeeId,
          currentEmployeeId: seat?.employeeId ?? 0,
          nextTag: nextTag ?? "",
          currentTag: seat?.tag ?? "",
          tagValid: nextTag != null,
        });
        if (plan.kind !== "accepted") return plan;
        if (!seat) return { kind: "not_found" as const };

        let credentialId = seat.credentialId;
        if (plan.employeeId !== seat.employeeId && credentialId == null) {
          credentialId = await attachUnlinkedSubmittedCredential(
            tx,
            plan.employeeId,
            seat.productLineId,
          );
        }

        const [updated] = await tx
          .update(channelSeats)
          .set({
            employeeId: plan.employeeId,
            tag: plan.tag,
            credentialId,
            updatedAt: new Date(),
          })
          .where(eq(channelSeats.id, seat.id))
          .returning({
            id: channelSeats.id,
            employeeId: channelSeats.employeeId,
            productLineId: channelSeats.productLineId,
            tag: channelSeats.tag,
            credentialId: channelSeats.credentialId,
          });
        if (!updated) return { kind: "not_found" as const };

        if (
          updated.credentialId != null
          && plan.employeeId !== seat.employeeId
        ) {
          const [credential] = await tx
            .select({
              id: upstreamCredentials.id,
              meta: upstreamCredentials.meta,
            })
            .from(upstreamCredentials)
            .where(eq(upstreamCredentials.id, updated.credentialId))
            .limit(1)
            .for("update");
          if (
            credential
            && isEmployeeSubmittedCredentialMeta(credential.meta, seat.employeeId)
          ) {
            const [channel] = await tx
              .select({ name: productLines.name })
              .from(productLines)
              .where(eq(productLines.id, seat.productLineId))
              .limit(1);
            const meta = credential.meta && typeof credential.meta === "object" && !Array.isArray(credential.meta)
              ? {
                ...(credential.meta as Record<string, unknown>),
                submittedByEmployeeId: plan.employeeId,
              }
              : credential.meta;
            await tx
              .update(upstreamCredentials)
              .set({
                meta,
                label: buildEmployeeSubmittedCredentialLabel(
                  channel?.name ?? "",
                  employeeName ?? "",
                ),
                updatedAt: new Date(),
              })
              .where(eq(upstreamCredentials.id, credential.id));
          }
        }

        await tx.insert(opsAuditLogs).values({
          actorEmployeeId: req.employeeId ?? null,
          action: "channel_seat.update",
          targetType: "channel_seat",
          targetId: String(updated.id),
          detail: {
            employeeId: updated.employeeId,
            previousEmployeeId: seat.employeeId,
            productLineId: updated.productLineId,
            tag: updated.tag,
            previousTag: seat.tag,
            credentialId: updated.credentialId,
          },
          ip: req.ip,
        });

        return { kind: "updated" as const, seat: updated };
      });

      if (result.kind === "unchanged") {
        return { success: true, data: { id: params.data.id, unchanged: true } };
      }
      if (result.kind !== "updated") {
        const error = seatUpdateError(result.kind);
        return reply.code(error.status).send({ success: false, message: error.message });
      }
      return { success: true, data: result.seat };
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
