import { computed, ref } from "vue";
import { http } from "@/api/http";
import { requestMessage } from "@/lib/request-error";

export type ChannelType = {
  code: string;
  title: string;
  company: string;
  color: string;
  productLabel: string;
  modelPrefix: string;
  productType: "api" | "coding_plan";
  models: {
    allowlist: string[];
    testModel: string;
  };
};

type ChannelTypesResponse = {
  success: boolean;
  message?: string;
  data?: ChannelType[];
};

let cached: ChannelType[] | null = null;
let inflight: Promise<ChannelType[]> | null = null;

async function fetchChannelTypes(): Promise<ChannelType[]> {
  if (cached) return cached;
  if (!inflight) {
    inflight = http
      .get<ChannelTypesResponse>("/api/admin/channel-types")
      .then(({ data }) => {
        if (!data.success || !Array.isArray(data.data)) {
          throw new Error(data.message || "加载渠道类型失败");
        }
        cached = data.data;
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useChannelTypes() {
  const types = ref<ChannelType[]>(cached ?? []);
  const loading = ref(cached == null);

  async function load(): Promise<ChannelType[]> {
    loading.value = cached == null;
    try {
      const rows = await fetchChannelTypes();
      types.value = rows;
      return rows;
    } finally {
      loading.value = false;
    }
  }

  const byCode = computed(() => {
    const map = new Map<string, ChannelType>();
    for (const row of types.value) map.set(row.code, row);
    return map;
  });

  return { types, loading, load, byCode, requestMessage };
}

export function channelTypeByCode(code: string): ChannelType | undefined {
  return cached?.find((row) => row.code === code);
}
