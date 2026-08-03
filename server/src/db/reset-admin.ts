import { eq } from "drizzle-orm";
import { env } from "../config.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { db, sql } from "./client.js";
import { employees } from "./schema/index.js";

async function main() {
  const phone = env.SEED_ADMIN_PHONE;
  const password = env.SEED_ADMIN_PASSWORD;
  const passwordHash = await hashPassword(password);

  const rows = await db
    .update(employees)
    .set({
      passwordHash,
      mustChangePassword: true,
      passwordChangedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(employees.phone, phone))
    .returning({
      id: employees.id,
      phone: employees.phone,
      mustChangePassword: employees.mustChangePassword,
    });

  if (rows.length === 0) {
    console.error("Admin not found for phone", phone);
    process.exit(1);
  }

  const [user] = await db.select().from(employees).where(eq(employees.phone, phone)).limit(1);
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  console.log("Admin password reset OK:", rows[0].phone, "verify=", ok);
  console.log("Use password from SEED_ADMIN_PASSWORD in .env (must change on next login)");
  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
