import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, authApi, healthApi } from "@/lib/api";
import { qk } from "./keys";
import type { Operator } from "@/types/api";

// --- health ---
export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: healthApi,
    refetchInterval: 30_000,
    retry: false,
  });
}

// --- self ---
export function useMyKeys(enabled = true) {
  return useQuery({
    queryKey: qk.myKeys,
    queryFn: authApi.myKeys,
    enabled,
    select: (d) => d.virtual_keys ?? [],
  });
}

export function usePatchMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.patchMe,
    onSuccess: (data) => {
      qc.setQueryData(qk.me, { operator: data.operator } satisfies { operator: Operator });
    },
  });
}

// --- admin ---
export function useOverview() {
  return useQuery({ queryKey: qk.admin.overview(), queryFn: adminApi.overview });
}
export function useUsers() {
  return useQuery({
    queryKey: qk.admin.users(),
    queryFn: adminApi.users,
    select: (d) => d.users ?? [],
  });
}
export function useProviderKeys() {
  return useQuery({
    queryKey: qk.admin.providerKeys(),
    queryFn: adminApi.providerKeys,
    select: (d) => d.provider_keys ?? [],
  });
}
export function usePools() {
  return useQuery({
    queryKey: qk.admin.pools(),
    queryFn: adminApi.pools,
    select: (d) => d.pools ?? [],
  });
}
export function useChannels() {
  return useQuery({
    queryKey: qk.admin.channels(),
    queryFn: adminApi.channels,
    select: (d) => d.channels ?? [],
  });
}
export function useVirtualKeys() {
  return useQuery({
    queryKey: qk.admin.virtualKeys(),
    queryFn: adminApi.virtualKeys,
    select: (d) => d.virtual_keys ?? [],
  });
}
export function useTeams() {
  return useQuery({
    queryKey: qk.admin.teams(),
    queryFn: adminApi.teams,
    select: (d) => d.teams ?? [],
  });
}
export function useProjects() {
  return useQuery({
    queryKey: qk.admin.projects(),
    queryFn: adminApi.projects,
    select: (d) => d.projects ?? [],
  });
}
export function useRouteDecisions() {
  return useQuery({
    queryKey: qk.admin.routeDecisions(),
    queryFn: adminApi.routeDecisions,
    select: (d) => d.route_decisions ?? [],
  });
}

/** Invalidate every admin list + overview after any catalog mutation. */
function useInvalidateAdmin() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.admin.all });
    void qc.invalidateQueries({ queryKey: qk.myKeys });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: adminApi.createUser, onSuccess: invalidate });
}
export function usePatchUser() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      adminApi.patchUser(id, body),
    onSuccess: invalidate,
  });
}
export function useCreateProviderKey() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: adminApi.createProviderKey, onSuccess: invalidate });
}
export function usePatchProviderKey() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      adminApi.patchProviderKey(id, body),
    onSuccess: invalidate,
  });
}
export function useCreatePool() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: adminApi.createPool, onSuccess: invalidate });
}
export function useCreateTeam() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: adminApi.createTeam, onSuccess: invalidate });
}
export function useCreateProject() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: adminApi.createProject, onSuccess: invalidate });
}
export function useCreateChannel() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: adminApi.createChannel, onSuccess: invalidate });
}
export function usePatchChannel() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      adminApi.patchChannel(id, body),
    onSuccess: invalidate,
  });
}
export function useCreateVK() {
  const invalidate = useInvalidateAdmin();
  return useMutation({ mutationFn: adminApi.createVK, onSuccess: invalidate });
}
export function usePatchVK() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      adminApi.patchVK(id, body),
    onSuccess: invalidate,
  });
}
