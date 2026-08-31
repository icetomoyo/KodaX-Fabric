/** Self-hosted / 自定义渠道：不按用量分档独占，有虚拟 Key 即可共用渠道 Key。 */
export const OPEN_POOL_PROVIDER_CODE = "custom";

export function isOpenPoolProvider(providerCode: string | null | undefined): boolean {
  return providerCode === OPEN_POOL_PROVIDER_CODE;
}
