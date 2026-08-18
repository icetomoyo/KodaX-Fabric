import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, ChevronRight, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LANGS,
  fabricErrors,
  samplesFor,
  type DocField,
  type EndpointDoc,
  type HttpMethod,
  type LangId,
} from "./spec";
import { DEFAULT_API, findEndpoint, navGroups, restSamples } from "./catalog";

function parseApi(raw: string | null): string {
  if (!raw) return DEFAULT_API;
  if (raw === "errors") return raw;
  if (findEndpoint(raw)) return raw;
  return DEFAULT_API;
}

export default function DocsPage() {
  const [params, setParams] = useSearchParams();
  const tab = parseApi(params.get("api"));
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const current = tab === "errors" ? undefined : findEndpoint(tab);

  function go(next: string) {
    const nextParams = new URLSearchParams(params);
    if (next === DEFAULT_API) nextParams.delete("api");
    else nextParams.set("api", next);
    setParams(nextParams, { replace: true });
  }

  return (
    <div className="-mx-8 -my-8 flex h-[calc(100vh-3.5rem)] overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h1 className="text-sm font-semibold text-foreground">接口文档</h1>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            全部 {navGroups.reduce((n, g) => n + g.items.filter((i) => i.kind === "api").length, 0)}{" "}
            个接口，按分类浏览。
          </p>
        </div>
        <nav aria-label="接口列表" className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {navGroups.map((group) => (
            <div key={group.title}>
              <p className="px-3 pb-2 text-[15px] font-semibold text-foreground">{group.title}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const id = item.kind === "api" ? item.doc.id : item.id;
                  const label = item.kind === "api" ? item.doc.title : item.title;
                  const method = item.kind === "api" ? item.doc.method : undefined;
                  const active = tab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => go(id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-left transition-colors",
                        active
                          ? "bg-blue-50 text-blue-600"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                      )}
                    >
                      {method ? <MethodBadge method={method} active={active} /> : null}
                      <span className={cn("text-sm", active && "font-medium")}>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
        {tab === "errors" ? <ErrorsDoc origin={origin} /> : null}
        {current ? <EndpointDocView doc={current} origin={origin} /> : null}
      </div>
    </div>
  );
}

function MethodBadge({ method, active }: { method: HttpMethod; active?: boolean }) {
  const tone =
    method === "GET"
      ? active
        ? "bg-emerald-600 text-white"
        : "bg-emerald-50 text-emerald-600"
      : method === "PATCH"
        ? active
          ? "bg-amber-500 text-white"
          : "bg-amber-50 text-amber-600"
        : method === "PUT"
          ? active
            ? "bg-violet-600 text-white"
            : "bg-violet-50 text-violet-600"
          : method === "DELETE"
            ? active
              ? "bg-rose-600 text-white"
              : "bg-rose-50 text-rose-600"
            : active
              ? "bg-blue-600 text-white"
              : "bg-blue-50 text-blue-500";
  return (
    <span
      className={cn(
        "inline-flex w-[3.75rem] shrink-0 justify-center rounded px-0 py-0.5 font-mono text-[10px] font-bold tracking-wide",
        tone,
      )}
    >
      {method}
    </span>
  );
}

function EndpointDocView({ doc, origin }: { doc: EndpointDoc; origin: string }) {
  const [lang, setLang] = useState<LangId>("curl");
  const samples = useMemo(() => {
    if (doc.id === "chat" || doc.id === "messages") return samplesFor(doc.id, origin);
    return restSamples(doc, origin);
  }, [doc, origin]);
  const sample = samples[lang];
  const gateway = doc.id === "chat" || doc.id === "messages";

  return (
    <article>
      <header className="mb-8">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{doc.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{doc.summary}</p>
        <p className="mt-2 text-sm leading-6 text-foreground/80">
          <RichText text={doc.description} />
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <MethodBadge method={doc.method} active />
          <code className="rounded-md bg-muted px-2 py-1 font-mono text-sm text-foreground">
            {doc.path}
          </code>
          {doc.adminOnly ? (
            <span className="text-xs text-amber-700">管理员</span>
          ) : doc.cookie ? (
            <span className="text-xs text-muted-foreground">需登录</span>
          ) : null}
          {doc.protocol ? (
            <span className="text-xs text-muted-foreground">{doc.protocol}</span>
          ) : null}
        </div>
      </header>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
        <div className="min-w-0 space-y-8">
          {doc.auth.length > 0 ? (
            <Section title="Authorizations">
              <FieldList fields={doc.auth} />
            </Section>
          ) : null}
          {doc.headers.length > 0 ? (
            <Section title="Headers">
              <FieldList fields={doc.headers} />
            </Section>
          ) : null}
          {doc.query && doc.query.length > 0 ? (
            <Section title="Query">
              <FieldList fields={doc.query} />
            </Section>
          ) : null}
          {doc.body.length > 0 ? (
            <Section title="Body" hint="application/json">
              <FieldList fields={doc.body} />
            </Section>
          ) : null}
          {doc.response.length > 0 ? (
            <Section title="响应字段">
              <FieldList fields={doc.response} />
            </Section>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-foreground">调用示例</h3>
            <CodePanel langs={LANGS} lang={lang} onLang={setLang} code={sample.request} />
          </section>
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="text-sm font-semibold text-foreground">响应</h3>
              {gateway ? (
                <span className="text-xs text-muted-foreground">与上游一致，网关不改写正文</span>
              ) : null}
            </div>
            <CodePanel code={sample.response} />
          </section>
        </aside>
      </div>
    </article>
  );
}

function ErrorsDoc({ origin }: { origin: string }) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">鉴权与错误</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          网关先校验虚拟钥匙，再查 Model 映射和价格，再打上游。下面是网关自己返回的错误；上游
          4xx/5xx 正文会按协议原样回传。网关错误统一为{" "}
          <code className="font-mono text-xs">{`{"error":"<code>"}`}</code>。
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground">怎么接</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-foreground/80">
          <li>
            OpenAI SDK / Cursor：Base URL 填{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{origin}/v1</code>
            ，Header <code className="font-mono text-xs">Authorization: Bearer sk-fab-…</code>
          </li>
          <li>
            Anthropic SDK / Claude Code：Base URL 填{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{origin}</code>
            ，Header <code className="font-mono text-xs">x-api-key: sk-fab-…</code>
          </li>
          <li>同一把 VK 可打两个端点；官方 Key 不会出现在调用方请求里。</li>
          <li>
            可选请求头 <code className="font-mono text-xs">x-fabric-context</code> 可带{" "}
            <code className="font-mono text-xs">project_id</code> /{" "}
            <code className="font-mono text-xs">task_type</code> /{" "}
            <code className="font-mono text-xs">run_id</code>，写入请求流水，不送到上游。
          </li>
        </ul>
      </section>

      <div className="space-y-4">
        {fabricErrors.map((err) => (
          <article
            key={`${err.status}-${err.code}`}
            className="rounded-lg border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{err.status}</Badge>
              <code className="font-mono text-sm font-medium text-foreground">{err.code}</code>
            </div>
            <p className="mt-2 text-sm leading-6 text-foreground/80">
              <RichText text={err.when} />
            </p>
            <div className="mt-3">
              <MiniCode label="响应" value={prettyJson(err.sample)} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2 border-b border-border pb-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function FieldList({ fields }: { fields: DocField[] }) {
  return (
    <div className="divide-y divide-border">
      {fields.map((field) => (
        <FieldRow key={field.name} field={field} />
      ))}
    </div>
  );
}

function FieldRow({ field, depth = 0 }: { field: DocField; depth?: number }) {
  const [open, setOpen] = useState(false);
  const hasChildren = Boolean(field.children?.length);
  return (
    <div style={{ paddingLeft: depth ? depth * 16 : 0 }}>
      <div className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 font-mono text-sm font-medium text-foreground"
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
              />
              {field.name}
            </button>
          ) : (
            <span className="font-mono text-sm font-medium text-foreground">{field.name}</span>
          )}
          <span className="font-mono text-xs text-muted-foreground">{field.type}</span>
          {field.required ? (
            <Badge variant="outline" className="border-destructive/40 text-destructive">
              required
            </Badge>
          ) : null}
          {field.defaultValue ? (
            <span className="text-xs text-muted-foreground">default: {field.defaultValue}</span>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm leading-6 text-foreground/80">
          <RichText text={field.description} />
        </p>
      </div>
      {hasChildren && open
        ? field.children!.map((c) => <FieldRow key={c.name} field={c} depth={depth + 1} />)
        : null}
    </div>
  );
}

function CodePanel({
  code,
  langs,
  lang,
  onLang,
}: {
  code: string;
  langs?: { id: LangId; label: string }[];
  lang?: LangId;
  onLang?: (id: LangId) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-slate-900 text-slate-100 shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {langs && lang && onLang ? (
            <div className="flex gap-0.5">
              {langs.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onLang(l.id)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px]",
                    lang === l.id
                      ? "bg-white/15 text-white"
                      : "text-slate-400 hover:bg-white/10 hover:text-slate-200",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-xs text-slate-400">JSON</span>
          )}
        </div>
        <CopyButton value={code} testId={langs ? "copy-example" : undefined} />
      </div>
      <pre className="max-h-[32rem] overflow-auto p-4 font-mono text-[12px] leading-6">{code}</pre>
    </div>
  );
}

function MiniCode({ label, value }: { label: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <CopyButton value={value} light />
      </div>
      <pre className="overflow-x-auto px-3 pb-3 font-mono text-[11px] leading-5 text-foreground/80">
        {value}
      </pre>
    </div>
  );
}

function CopyButton({ value, light, testId }: { value: string; light?: boolean; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-testid={testId}
      className={cn(
        "h-7 w-7 shrink-0",
        light ? "text-muted-foreground" : "text-slate-300 hover:bg-white/10 hover:text-white",
      )}
      aria-label="复制"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
