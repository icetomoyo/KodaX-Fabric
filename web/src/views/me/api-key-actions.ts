import { ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";

export type OrgDepartment = {
  id: number;
  name: string;
  path?: string;
  teamId: number;
};

/** 复制、更新、删除只用到这几个字段；API Key 和潮汐KEY 都满足。 */
export type ApiKeyRef = {
  id: number;
  name: string;
  key: string | null;
  keyPrefix: string;
};

export function getErrorMessage(error: unknown, fallback: string): string {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** 我所在的部门；Key 都挂在部门下，没加入部门时为空。 */
export async function loadMyDepartments(): Promise<OrgDepartment[]> {
  try {
    const { data } = await http.get("/api/me/org");
    if (data.success && Array.isArray(data.data?.departments) && data.data.departments.length > 0) {
      return data.data.departments;
    }
    const teams = Array.isArray(data.data?.teams) ? data.data.teams : [];
    return teams
      .filter((team: { isDefault?: boolean }) => team.isDefault !== false)
      .map((team: { id: number; departmentId?: number; departmentName?: string; name: string }) => ({
        id: team.departmentId ?? team.id,
        name: team.departmentName ?? team.name,
        path: team.departmentName ?? team.name,
        teamId: team.id,
      }));
  } catch {
    return [];
  }
}

/** 一把 Key 的复制、更新、删除；API Key 页和潮汐KEY 页共用。 */
export function useApiKeyActions(reload: () => Promise<void>) {
  const deletingId = ref<number | null>(null);
  const copyingId = ref<number | null>(null);
  const regeneratingId = ref<number | null>(null);

  async function copyKey(row: ApiKeyRef) {
    if (!row.key) return;
    copyingId.value = row.id;
    try {
      const copied = await copyText(row.key);
      if (copied) {
        ElMessage.success("API Key 已复制");
      } else {
        ElMessage.error("复制失败，请手动选中 Key 文本复制");
      }
    } finally {
      copyingId.value = null;
    }
  }

  async function regenerateKey(row: ApiKeyRef) {
    try {
      await ElMessageBox.confirm(
        `确认更新「${row.name || "API Key"}」的 API Key（${row.keyPrefix}••••）？更新后立即换发新 Key，旧 Key 马上失效，正在使用的客户端需要改用新 Key。`,
        "更新 API Key",
        {
          type: "warning",
          confirmButtonText: "更新",
          cancelButtonText: "取消",
        },
      );
    } catch {
      return;
    }

    regeneratingId.value = row.id;
    try {
      await http.post(`/api/me/api-keys/${row.id}/regenerate`);
      ElMessage.success("API Key 已更新");
      await reload();
    } catch (error) {
      ElMessage.error(getErrorMessage(error, "更新失败"));
    } finally {
      regeneratingId.value = null;
    }
  }

  async function removeKey(row: ApiKeyRef) {
    const keyName = row.name.trim();

    try {
      await ElMessageBox.confirm(
        `确认删除 API Key「${keyName}」（${row.keyPrefix}••••）？删除后不可恢复，使用该 Key 的客户端将立即失效。`,
        "删除 API Key",
        {
          type: "warning",
          confirmButtonText: "继续",
          cancelButtonText: "取消",
          confirmButtonClass: "el-button--danger",
        },
      );
    } catch {
      return;
    }

    try {
      await ElMessageBox.prompt(
        `删除不可恢复。请再次输入 Key 名称「${keyName}」以完成二次确认。`,
        "二次确认删除",
        {
          inputPlaceholder: "请输入 Key 名称",
          inputValidator: (value) =>
            value?.trim() === keyName ? true : "输入内容与 Key 名称不一致",
          confirmButtonText: "确认删除",
          cancelButtonText: "取消",
          confirmButtonClass: "el-button--danger",
        },
      );
    } catch {
      return;
    }

    deletingId.value = row.id;
    try {
      await http.delete(`/api/me/api-keys/${row.id}`);
      ElMessage.success("已删除");
      await reload();
    } catch (error) {
      ElMessage.error(getErrorMessage(error, "删除失败"));
    } finally {
      deletingId.value = null;
    }
  }

  return { deletingId, copyingId, regeneratingId, copyKey, regenerateKey, removeKey };
}
