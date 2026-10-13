ALTER TABLE "credential_binding_members" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
-- 调度改为按亲和度选 Key、按成员记录绑定。旧的档位绑定（员工独占、5 人拼车）
-- 不再有对应语义：清空后每个人下一次请求按新规则重新挂 Key，成员行随绑定级联删除。
DELETE FROM "credential_bindings";
