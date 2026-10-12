/**
 * 请求全文目录的磁盘占用统计，供超级管理员工作台展示。
 *
 * 磁盘整体用量用 statfs 实时取，很快。目录自身占用要遍历文件：生产上一次全量 du
 * 超过一分钟，所以由后台定时统计、结果缓存，页面只读缓存。
 * 已经过去的日目录不会再写入，量过一次就记进 <root>/.storage-usage.json，
 * 之后每轮只重新量最近两天，以及按内容去重、持续增长的 files/ 和 blocks/。
 *
 * 会出错的方式（先列，再写代码）：
 * - 根目录还不存在（新环境没有任何请求）：按 0 字节返回，不报错。
 * - 遍历途中文件被改名或删除（写入是先写临时文件再 rename）：跳过该文件，不中断整轮。
 * - 缓存文件损坏或版本不对：丢弃，退回全量统计。
 * - 统计中途进程退出：缓存只在整轮结束后落盘，不会留下只量了一半的“已封存”日期。
 * - 上一轮没跑完又触发一轮：并发两轮会把磁盘 IO 翻倍，必须只跑一轮。
 * - 当天、昨天的目录仍在写入（跨零点的长请求）：这两天每轮都重新量，不封存。
 * - 历史不足一天：增速没有意义，返回 null，页面不显示预计天数。
 * - 近 7 天没有任何写入：日均增长为 0，预计天数返回 null，避免除以零。
 */
import type { Dirent } from "node:fs";
import { lstat, mkdir, opendir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../config.js";
import { addCalendarDays, quotaDayAt } from "./quota-time.js";

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_SCAN_DELAY_MS = 30_000;
const CACHE_FILE = ".storage-usage.json";
const CACHE_VERSION = 1;
const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;
const GROWTH_WINDOW_DAYS = 7;
const RECENT_DAYS = 14;

type Usage = { bytes: number; files: number };

type UsageSnapshot = {
  version: number;
  scannedAt: string;
  durationMs: number;
  /** 按日目录归属的占用：旧版 <root>/<day> 加上 <root>/users/<员工>/<day>。 */
  days: Record<string, Usage>;
  /** files/ 与 blocks/ 的合计。 */
  shared: Usage;
  /** files/ 与 blocks/ 按文件修改日期分摊的字节数，用来算每日增长。 */
  sharedByDay: Record<string, number>;
};

export type RequestContextStorageReport = {
  disk: { totalBytes: number; usedBytes: number; freeBytes: number } | null;
  logs: {
    bytes: number;
    files: number;
    scannedAt: string;
    durationMs: number;
    recentDays: Array<{ day: string; bytes: number }>;
    dailyGrowthBytes: number | null;
    daysLeft: number | null;
  } | null;
  scanning: boolean;
};

let snapshot: UsageSnapshot | null = null;
let cacheLoaded = false;
let running: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let firstRun: ReturnType<typeof setTimeout> | null = null;

function rootDir(): string {
  return resolve(env.REQUEST_CONTEXT_DIR);
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function listDir(path: string): Promise<Dirent[]> {
  try {
    const entries: Dirent[] = [];
    for await (const entry of await opendir(path)) entries.push(entry);
    return entries;
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** 递归累加一个目录的实际占用（按磁盘块算，小文件不会被低估）。 */
async function walk(
  path: string,
  onFile: (bytes: number, mtime: Date) => void,
): Promise<void> {
  for (const entry of await listDir(path)) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await walk(child, onFile);
    } else if (entry.isFile()) {
      try {
        const stat = await lstat(child);
        onFile(stat.blocks * 512, stat.mtime);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
  }
}

async function measure(path: string): Promise<Usage> {
  const usage: Usage = { bytes: 0, files: 0 };
  await walk(path, (bytes) => {
    usage.bytes += bytes;
    usage.files += 1;
  });
  return usage;
}

function add(target: Record<string, Usage>, day: string, usage: Usage): void {
  const current = target[day] ?? { bytes: 0, files: 0 };
  target[day] = { bytes: current.bytes + usage.bytes, files: current.files + usage.files };
}

async function loadCache(root: string): Promise<UsageSnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(join(root, CACHE_FILE), "utf8")) as UsageSnapshot;
    if (parsed?.version !== CACHE_VERSION || typeof parsed.days !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveCache(root: string, value: UsageSnapshot): Promise<void> {
  await mkdir(root, { recursive: true });
  const target = join(root, CACHE_FILE);
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, target);
}

async function scan(now: Date): Promise<UsageSnapshot> {
  const startedAt = Date.now();
  const root = rootDir();
  if (!cacheLoaded) {
    snapshot = await loadCache(root);
    cacheLoaded = true;
  }
  const today = quotaDayAt(now, env.QUOTA_TIMEZONE);
  // 今天和昨天仍可能写入，其余日期沿用上一轮的结果。
  const sealedBefore = addCalendarDays(today, -1);
  const sealed = snapshot?.days ?? {};
  const isSealed = (day: string) => day < sealedBefore && sealed[day] !== undefined;

  // 先只列目录（不读文件），找出所有日目录；这一步很快。
  const dayDirs: Array<{ day: string; path: string }> = [];
  for (const entry of await listDir(root)) {
    if (entry.isDirectory() && DAY_DIR.test(entry.name)) {
      dayDirs.push({ day: entry.name, path: join(root, entry.name) });
    }
  }
  for (const employee of await listDir(join(root, "users"))) {
    if (!employee.isDirectory()) continue;
    const employeeDir = join(root, "users", employee.name);
    for (const entry of await listDir(employeeDir)) {
      if (entry.isDirectory() && DAY_DIR.test(entry.name)) {
        dayDirs.push({ day: entry.name, path: join(employeeDir, entry.name) });
      }
    }
  }

  // 封存的日期只在目录还在时沿用：整天的目录被清理掉后，占用要跟着归零。
  // 只删掉某一天里部分员工的目录不会被发现，那种情况需要删除缓存文件重新全量统计。
  const days: Record<string, Usage> = {};
  for (const { day } of dayDirs) {
    if (isSealed(day)) days[day] = sealed[day];
  }
  for (const { day, path } of dayDirs) {
    if (!isSealed(day)) add(days, day, await measure(path));
  }

  const shared: Usage = { bytes: 0, files: 0 };
  const sharedByDay: Record<string, number> = {};
  for (const store of ["files", "blocks"]) {
    await walk(join(root, store), (bytes, mtime) => {
      shared.bytes += bytes;
      shared.files += 1;
      const day = quotaDayAt(mtime, env.QUOTA_TIMEZONE);
      sharedByDay[day] = (sharedByDay[day] ?? 0) + bytes;
    });
  }

  const result: UsageSnapshot = {
    version: CACHE_VERSION,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    days,
    shared,
    sharedByDay,
  };
  await saveCache(root, result);
  return result;
}

/** 触发一轮统计；已有一轮在跑时复用它，不并发。 */
export function refreshRequestContextStorage(logger?: FastifyBaseLogger): Promise<void> {
  running ??= scan(new Date())
    .then((result) => {
      snapshot = result;
      logger?.info({ durationMs: result.durationMs }, "request context storage scanned");
    })
    .catch((err) => {
      logger?.error({ err }, "request context storage scan failed");
    })
    .finally(() => {
      running = null;
    });
  return running;
}

async function readDisk(): Promise<RequestContextStorageReport["disk"]> {
  // 根目录还没建时，退到它已存在的上级目录，量的是同一块盘。
  let path = rootDir();
  for (;;) {
    try {
      const stat = await statfs(path);
      return {
        totalBytes: stat.blocks * stat.bsize,
        usedBytes: (stat.blocks - stat.bfree) * stat.bsize,
        freeBytes: stat.bavail * stat.bsize,
      };
    } catch (error) {
      const parent = dirname(path);
      if (!isMissing(error) || parent === path) return null;
      path = parent;
    }
  }
}

export async function requestContextStorageReport(
  now: Date = new Date(),
): Promise<RequestContextStorageReport> {
  const disk = await readDisk();
  if (!cacheLoaded && !running) {
    snapshot = await loadCache(rootDir());
    cacheLoaded = true;
  }
  const current = snapshot;
  if (!current) return { disk, logs: null, scanning: running !== null };

  const dayBytes = (day: string) => (current.days[day]?.bytes ?? 0) + (current.sharedByDay[day] ?? 0);
  const today = quotaDayAt(now, env.QUOTA_TIMEZONE);
  const recentDays = Array.from({ length: RECENT_DAYS }, (_, index) => {
    const day = addCalendarDays(today, index - RECENT_DAYS + 1);
    return { day, bytes: dayBytes(day) };
  });

  // 只用已结束的日子算增速；今天还没过完，算进去会低估。
  const allDays = [...Object.keys(current.days), ...Object.keys(current.sharedByDay)];
  const hasHistory = allDays.some((day) => day < today);
  let windowBytes = 0;
  for (let offset = 1; offset <= GROWTH_WINDOW_DAYS; offset += 1) {
    windowBytes += dayBytes(addCalendarDays(today, -offset));
  }
  const dailyGrowthBytes = hasHistory ? Math.round(windowBytes / GROWTH_WINDOW_DAYS) : null;
  const daysLeft =
    disk && dailyGrowthBytes ? Math.floor(disk.freeBytes / dailyGrowthBytes) : null;

  let bytes = current.shared.bytes;
  let files = current.shared.files;
  for (const usage of Object.values(current.days)) {
    bytes += usage.bytes;
    files += usage.files;
  }

  return {
    disk,
    logs: {
      bytes,
      files,
      scannedAt: current.scannedAt,
      durationMs: current.durationMs,
      recentDays,
      dailyGrowthBytes,
      daysLeft,
    },
    scanning: running !== null,
  };
}

export function startRequestContextStorageScan(logger: FastifyBaseLogger): void {
  if (timer) return;
  // 启动后稍等再量，避开迁移和预热；首轮全量在生产上要跑几分钟。
  firstRun = setTimeout(() => void refreshRequestContextStorage(logger), FIRST_SCAN_DELAY_MS);
  firstRun.unref?.();
  timer = setInterval(() => void refreshRequestContextStorage(logger), SCAN_INTERVAL_MS);
  timer.unref?.();
}

export function stopRequestContextStorageScan(): void {
  if (firstRun) clearTimeout(firstRun);
  if (timer) clearInterval(timer);
  firstRun = null;
  timer = null;
}
