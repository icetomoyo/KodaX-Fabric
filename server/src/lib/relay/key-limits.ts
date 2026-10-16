import { env } from "../../config.js";

/** 套餐没填时走全局默认：每把 Key 最多挂几个员工。 */
export function effectiveKeyMaxMembers(value: number | null | undefined): number {
  return value ?? env.RELAY_KEY_MAX_MEMBERS;
}

/** 套餐没填时走全局默认：每把 Key 最多几路在途。 */
export function effectiveKeyMaxConcurrency(value: number | null | undefined): number {
  return value ?? env.RELAY_KEY_MAX_CONCURRENCY;
}
