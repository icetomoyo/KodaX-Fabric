# 项目用量靠 KodaX 请求头，不靠 Key

ADR 0001 仍然成立：一把员工 Key 看不出这次调用属于哪个项目，所以不按项目发 Key。项目级归因改走调用方上下文——只有 KodaX Space / KodaX 会在请求头带项目 ID。Token Hub 在该员工已绑定该项目时，把这一次用量记到项目；没有项目 ID、或项目未绑定（Cursor 等直连 Token Hub）则记在所属部门，下一步记在所属团队。
