import type postgres from "postgres";

/**
 * 一个渠道一个调度池：同一渠道下所有启用的套餐共享 Key。用例要独占一个池子时，
 * 只启用自己的套餐、停用同渠道的其他套餐，并清掉这个池子里的成员关系，
 * 让调度从干净的状态开始。返回的函数把各套餐的启用状态放回原样。
 */
export async function isolateChannelPool(
  sql: postgres.Sql,
  channelCode: string,
  activeLineIds: readonly number[],
): Promise<() => Promise<void>> {
  const lines = await sql<Array<{ id: string; status: string }>>`
    select pl.id, pl.status
    from product_lines pl
    join providers p on p.id = pl.provider_id
    where p.code = ${channelCode}
  `;
  const keep = new Set(activeLineIds);
  for (const id of activeLineIds) {
    if (!lines.some((line) => Number(line.id) === id)) {
      throw new Error(`套餐 ${id} 不在渠道 ${channelCode} 下`);
    }
  }
  for (const line of lines) {
    await sql`
      update product_lines
      set status = ${keep.has(Number(line.id)) ? "active" : "disabled"}
      where id = ${line.id}
    `;
  }
  await clearPoolBindings(sql, channelCode);
  return async () => {
    for (const line of lines) {
      await sql`update product_lines set status = ${line.status} where id = ${line.id}`;
    }
  };
}

async function clearPoolBindings(sql: postgres.Sql, poolKey: string): Promise<void> {
  await sql`delete from credential_binding_members where relay_pool_key = ${poolKey}`;
  await sql`delete from credential_bindings where relay_pool_key = ${poolKey}`;
}
