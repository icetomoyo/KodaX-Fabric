import { computed, ref, watch, toValue, type MaybeRefOrGetter } from "vue";

export const TABLE_PAGE_SIZE = 10;

export function sliceTablePage<T>(
  items: readonly T[],
  page: number,
  pageSize = TABLE_PAGE_SIZE,
): T[] {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function useTablePage<T>(
  source: MaybeRefOrGetter<readonly T[]>,
  pageSize = TABLE_PAGE_SIZE,
) {
  const page = ref(1);
  const items = computed(() => toValue(source));
  const total = computed(() => items.value.length);

  watch(
    [total, page],
    () => {
      const maxPage = Math.max(1, Math.ceil(total.value / pageSize));
      if (page.value > maxPage) page.value = maxPage;
    },
    { immediate: true },
  );

  const paged = computed(() => sliceTablePage(items.value, page.value, pageSize));

  function resetPage() {
    page.value = 1;
  }

  return { page, paged, total, pageSize, resetPage };
}
