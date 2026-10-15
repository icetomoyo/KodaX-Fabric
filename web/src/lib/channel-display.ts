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
  providerName: string;
  productLineName: string;
}): string {
  return formatChannelName(channel.providerName, channel.productLineName);
}
