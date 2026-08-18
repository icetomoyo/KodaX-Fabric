import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, healthApi } from "@/lib/api";
import { qk } from "./keys";

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: healthApi,
    refetchInterval: 30_000,
    retry: false,
  });
}

function invalidateAdmin(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: qk.admin.all });
}

export function useProjects() {
  return useQuery({
    queryKey: qk.admin.projects(),
    queryFn: adminApi.projects,
    select: (d) => d.projects ?? [],
  });
}
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createProject,
    onSuccess: () => invalidateAdmin(qc),
  });
}

export function useVirtualKeys() {
  return useQuery({
    queryKey: qk.admin.virtualKeys(),
    queryFn: adminApi.virtualKeys,
    select: (d) => d.keys ?? [],
  });
}
export function useCreateVK() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createVK,
    onSuccess: () => invalidateAdmin(qc),
  });
}
export function useDisableVK() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.disableVK,
    onSuccess: () => invalidateAdmin(qc),
  });
}

export function useProviders() {
  return useQuery({
    queryKey: qk.admin.providers(),
    queryFn: adminApi.providers,
    select: (d) => d.providers ?? [],
  });
}
export function useCreateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createProvider,
    onSuccess: () => invalidateAdmin(qc),
  });
}
export function useDisableProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.disableProvider,
    onSuccess: () => invalidateAdmin(qc),
  });
}

export function useModels() {
  return useQuery({
    queryKey: qk.admin.models(),
    queryFn: adminApi.models,
    select: (d) => d.models ?? [],
  });
}
export function useCreateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createModel,
    onSuccess: () => invalidateAdmin(qc),
  });
}
export function useDisableModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.disableModel,
    onSuccess: () => invalidateAdmin(qc),
  });
}

export function usePrices() {
  return useQuery({
    queryKey: qk.admin.prices(),
    queryFn: adminApi.prices,
    select: (d) => d.prices ?? [],
  });
}
export function useUpsertPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      model,
      ...body
    }: {
      model: string;
      input_cny: number;
      output_cny: number;
      cached_cny: number;
    }) => adminApi.upsertPrice(model, body),
    onSuccess: () => invalidateAdmin(qc),
  });
}
export function useDeletePrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.deletePrice,
    onSuccess: () => invalidateAdmin(qc),
  });
}

export function useUsage(day?: string, project?: string) {
  return useQuery({
    queryKey: qk.admin.usage(day, project),
    queryFn: () => adminApi.usage(day, project),
  });
}

export function useRequests(project?: string) {
  return useQuery({
    queryKey: qk.admin.requests(project),
    queryFn: () => adminApi.requests(project),
  });
}
