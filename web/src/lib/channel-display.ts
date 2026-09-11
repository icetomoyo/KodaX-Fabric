/** 官方模板渠道的展示名，按供应商 + 产品线 code。 */
const OFFICIAL_LINE_TITLES: Record<string, string> = {
  "glm:api": "GLM（国内版）",
  "glm:api_intl": "GLM（国际版）",
};

/** 公司名称/模型名称，如 智谱/GLM、深度求索/DeepSeek */
export function formatChannelName(companyName: string, modelName: string): string {
  const company = companyName.trim();
  const model = modelName.trim();
  if (!company) return model;
  if (!model) return company;
  if (company === model || model.startsWith(`${company}/`)) return model;
  return `${company}/${model}`;
}

export function channelDisplayName(channel: {
  providerCode: string;
  providerName: string;
  productLineCode: string;
  productLineName: string;
}): string {
  const official = OFFICIAL_LINE_TITLES[`${channel.providerCode}:${channel.productLineCode}`];
  return formatChannelName(channel.providerName, official || channel.productLineName);
}
