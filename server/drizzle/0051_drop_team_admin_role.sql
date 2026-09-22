-- 清理已取消的「团队管理员」角色（CONTEXT.md：团队管理员已取消；生产与本地均无该角色数据）
-- 1) employee_role 枚举去掉 team_admin（PG 不支持 DROP VALUE，需重建类型）
CREATE TYPE "employee_role_next" AS ENUM ('employee', 'admin', 'org_admin', 'dept_admin');--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "role" TYPE "employee_role_next" USING ("role"::text::"employee_role_next");--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "role" SET DEFAULT 'employee'::"employee_role_next";--> statement-breakpoint
DROP TYPE "employee_role";--> statement-breakpoint
ALTER TYPE "employee_role_next" RENAME TO "employee_role";--> statement-breakpoint
-- 2) team_members.role 列整体删除（全部为默认值 member，无信息量）
ALTER TABLE "team_members" DROP COLUMN IF EXISTS "role";--> statement-breakpoint
DROP TYPE IF EXISTS "team_member_role";
