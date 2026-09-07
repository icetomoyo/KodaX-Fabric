<template>
  <el-drawer
    :model-value="modelValue"
    title="切换临时权限"
    direction="rtl"
    size="400px"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="act-as">
      <el-input
        v-model="query"
        clearable
        placeholder="搜索企业 / 部门 / 团队 / 员工"
      />

      <el-button
        v-if="auth.actAs"
        class="clear-btn"
        @click="clearActAs"
      >
        退出临时权限
      </el-button>

      <el-empty
        v-if="!loading && !visibleEnterprises.length"
        description="暂无组织"
        :image-size="72"
      />

      <div v-loading="loading" class="tree">
        <section
          v-for="enterprise in visibleEnterprises"
          :key="enterprise.id"
          class="unit"
        >
          <div class="unit-row">
            <div class="unit-copy">
              <strong>{{ enterprise.name }}</strong>
              <span>{{ enterprise.code }}</span>
            </div>
            <el-button
              link
              type="primary"
              @click="select({
                role: 'org_admin',
                enterpriseId: enterprise.id,
              })"
            >
              企业管理员
            </el-button>
          </div>

          <article
            v-for="department in enterprise.departments"
            :key="department.id"
            class="unit nested"
          >
            <div class="unit-row">
              <div class="unit-copy">
                <strong>{{ department.name }}</strong>
              </div>
              <el-button
                link
                type="primary"
                @click="select({
                  role: 'dept_admin',
                  enterpriseId: enterprise.id,
                  departmentId: department.id,
                })"
              >
                部门管理员
              </el-button>
            </div>
            <div
              v-for="person in department.employees"
              :key="`dept-${person.id}`"
              class="unit-row nested"
            >
              <div class="unit-copy">
                <strong>{{ person.name }}</strong>
              </div>
              <el-button
                link
                type="primary"
                @click="select({
                  role: 'employee',
                  enterpriseId: enterprise.id,
                  departmentId: department.id,
                  employeeId: person.id,
                })"
              >
                员工
              </el-button>
            </div>
            <div
              v-for="team in department.teams"
              :key="team.id"
              class="team-block"
            >
              <div class="unit-row nested">
                <div class="unit-copy">
                  <strong>{{ team.name }}</strong>
                </div>
                <el-button
                  link
                  type="primary"
                  @click="select({
                    role: 'team_admin',
                    enterpriseId: enterprise.id,
                    departmentId: department.id,
                    teamId: team.id,
                  })"
                >
                  团队管理员
                </el-button>
              </div>
              <div
                v-for="person in team.employees"
                :key="person.id"
                class="unit-row nested person"
              >
                <div class="unit-copy">
                  <strong>{{ person.name }}</strong>
                </div>
                <el-button
                  link
                  type="primary"
                  @click="select({
                    role: 'employee',
                    enterpriseId: enterprise.id,
                    departmentId: department.id,
                    teamId: team.id,
                    employeeId: person.id,
                  })"
                >
                  员工
                </el-button>
              </div>
            </div>
          </article>
        </section>
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { useAuthStore, type ActAsPayload } from "@/stores/auth";

type PersonNode = { id: number; name: string };
type TeamNode = { id: number; name: string; employees: PersonNode[] };
type DepartmentNode = {
  id: number;
  name: string;
  employees: PersonNode[];
  teams: TeamNode[];
};
type EnterpriseNode = {
  id: number;
  name: string;
  code: string;
  departments: DepartmentNode[];
};

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

const auth = useAuthStore();
const router = useRouter();
const loading = ref(false);
const query = ref("");
const enterprises = ref<EnterpriseNode[]>([]);

const visibleEnterprises = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return enterprises.value;
  return enterprises.value.flatMap((enterprise) => {
    const enterpriseHit = matches(enterprise.name, needle) || matches(enterprise.code, needle);
    const departments = enterprise.departments.flatMap((department) => {
      const departmentHit = matches(department.name, needle);
      const employees = department.employees.filter((person) => matches(person.name, needle));
      const teams = department.teams.flatMap((team) => {
        const teamHit = matches(team.name, needle);
        const teamEmployees = team.employees.filter((person) => matches(person.name, needle));
        if (enterpriseHit || departmentHit || teamHit || teamEmployees.length) {
          return [{
            ...team,
            employees: enterpriseHit || departmentHit || teamHit ? team.employees : teamEmployees,
          }];
        }
        return [];
      });
      if (enterpriseHit || departmentHit || employees.length || teams.length) {
        return [{
          ...department,
          employees: enterpriseHit || departmentHit ? department.employees : employees,
          teams: enterpriseHit || departmentHit ? department.teams : teams,
        }];
      }
      return [];
    });
    if (enterpriseHit || departments.length) {
      return [{ ...enterprise, departments: enterpriseHit ? enterprise.departments : departments }];
    }
    return [];
  });
});

function matches(value: string, needle: string) {
  return value.toLowerCase().includes(needle);
}

async function loadTree() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/act-as/org");
    if (data.success) enterprises.value = data.data;
  } catch (error) {
    const message = (error as { response?: { data?: { message?: unknown } } })
      ?.response?.data?.message;
    ElMessage.error(typeof message === "string" ? message : "加载组织失败");
  } finally {
    loading.value = false;
  }
}

async function select(payload: ActAsPayload) {
  auth.setActAs(payload);
  try {
    await auth.fetchMe();
    emit("update:modelValue", false);
    await goToRoleHome(payload.role);
  } catch (error) {
    auth.setActAs(null);
    const message = (error as { response?: { data?: { message?: unknown } } })
      ?.response?.data?.message;
    ElMessage.error(typeof message === "string" ? message : "切换失败");
  }
}

async function clearActAs() {
  auth.setActAs(null);
  try {
    await auth.fetchMe();
    emit("update:modelValue", false);
    await goToRoleHome("admin");
  } catch {
    ElMessage.error("退出临时权限失败");
  }
}

async function goToRoleHome(role: ActAsPayload["role"] | "admin") {
  const path = router.currentRoute.value.path;
  if (role === "employee") {
    if (!path.startsWith("/me")) await router.replace("/me");
    return;
  }
  if (path.startsWith("/me") || path === "/admin/keys") {
    await router.replace("/admin");
    return;
  }
  if (
    path.startsWith("/admin/credentials")
    || path.startsWith("/admin/model-prices")
    || path.startsWith("/admin/logs")
    || path.startsWith("/admin/ops-audit")
    || (path.startsWith("/admin/key-bindings") && role !== "org_admin")
  ) {
    await router.replace("/admin");
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void loadTree();
  },
);
</script>

<style scoped>
.act-as {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.clear-btn {
  align-self: flex-start;
}
.tree {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 120px;
}
.unit {
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
}
.unit.nested {
  margin-top: 8px;
  background: #f8fafc;
}
.unit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.unit-row.nested {
  margin-top: 6px;
  padding-left: 12px;
}
.unit-row.person {
  padding-left: 24px;
}
.team-block {
  margin-top: 4px;
}
.unit-copy {
  min-width: 0;
}
.unit-copy strong {
  display: block;
  color: #0f172a;
  font-size: 13px;
}
.unit-copy span {
  color: #94a3b8;
  font-size: 12px;
}
</style>
