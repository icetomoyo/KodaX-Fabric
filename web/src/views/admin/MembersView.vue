<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">团队成员</h2>
      <el-button type="primary" @click="openInvite">邀请已注册员工</el-button>
    </div>

    <el-form v-if="teams.length > 1" inline style="margin: 12px 0">
      <el-form-item>
        <el-select v-model="teamFilter" placeholder="全部团队" clearable style="width: 200px" @change="loadMembers">
          <el-option v-for="item in teams" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </el-form-item>
    </el-form>

    <el-table :data="rows" stripe>
      <el-table-column prop="name" label="姓名" min-width="120" />
      <el-table-column prop="phone" label="手机号" width="140" />
      <el-table-column prop="teamName" label="团队" min-width="140" />
      <el-table-column label="团队角色" width="120">
        <template #default="{ row }">
          {{ row.role === "team_admin" ? "团队管理员" : "成员" }}
        </template>
      </el-table-column>
      <el-table-column label="今日 Tokens" min-width="120">
        <template #default="{ row }">
          <span class="mono-num">{{ formatTokenCompact(row.todayTotalTokens) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="本月 Tokens" min-width="120">
        <template #default="{ row }">
          <span class="mono-num">{{ formatTokenCompact(row.monthTotalTokens) }}</span>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showInvite" title="邀请已注册员工" width="480px">
      <el-form label-width="90px">
        <el-form-item label="手机号" required>
          <el-input v-model="invitePhone" placeholder="已注册用户的手机号" />
        </el-form-item>
        <el-form-item label="加入团队" required>
          <el-select v-model="inviteTeamId" style="width: 100%" placeholder="选择团队">
            <el-option v-for="item in teams" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <p class="form-help">不能新建账号。对方必须已自行注册，邀请进团队后才有员工权限。</p>
      </el-form>
      <template #footer>
        <el-button @click="showInvite = false">取消</el-button>
        <el-button type="primary" :loading="inviting" @click="inviteMember">邀请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatTokenCompact } from "@/lib/tokens";

type TeamRow = { id: number; name: string };
type MemberRow = {
  id: number;
  name: string;
  phone: string;
  teamId: number;
  teamName: string;
  role: "member" | "team_admin";
  todayTotalTokens: number;
  monthTotalTokens: number;
};

const teams = ref<TeamRow[]>([]);
const rows = ref<MemberRow[]>([]);
const teamFilter = ref<number | "">("");
const showInvite = ref(false);
const inviting = ref(false);
const invitePhone = ref("");
const inviteTeamId = ref<number | undefined>();

async function loadTeams() {
  const { data } = await http.get("/api/admin/teams");
  if (data.success) teams.value = data.data;
}

async function loadMembers() {
  const targets = teamFilter.value
    ? teams.value.filter((team) => team.id === teamFilter.value)
    : teams.value;
  const lists = await Promise.all(
    targets.map(async (team) => {
      const { data } = await http.get(`/api/admin/teams/${team.id}/members`);
      const members = (data.success ? data.data : []) as Array<Omit<MemberRow, "teamId" | "teamName">>;
      return members.map((member) => ({
        ...member,
        teamId: team.id,
        teamName: team.name,
      }));
    }),
  );
  rows.value = lists.flat();
}

function openInvite() {
  invitePhone.value = "";
  inviteTeamId.value = (typeof teamFilter.value === "number" ? teamFilter.value : teams.value[0]?.id);
  showInvite.value = true;
}

async function inviteMember() {
  const phone = invitePhone.value.trim();
  if (phone.length < 5) {
    ElMessage.warning("请填写已注册用户的手机号");
    return;
  }
  if (!inviteTeamId.value) {
    ElMessage.warning("请选择团队");
    return;
  }
  inviting.value = true;
  try {
    const { data } = await http.post(`/api/admin/teams/${inviteTeamId.value}/members`, {
      phone,
      role: "member",
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已邀请进团队");
    showInvite.value = false;
    await loadMembers();
  } catch (e: unknown) {
    const message = (e as { response?: { data?: { message?: string } }; message?: string })
      .response?.data?.message;
    ElMessage.error(message || (e as Error).message || "邀请失败");
  } finally {
    inviting.value = false;
  }
}

onMounted(async () => {
  await loadTeams();
  await loadMembers();
});
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.mono-num {
  font-variant-numeric: tabular-nums;
}
.form-help {
  margin: 0 0 0 90px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}
</style>
