import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { LoginCard } from "@/pages/LoginCard";
import { Shell } from "@/pages/Shell";
import { UsageNote } from "@/pages/UsageNote";

export function HomePage() {
  const { session, loading } = useSession();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Shell title="Token Hub">
      <UsageNote origin={origin} />
      {loading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      {!loading && !session ? <LoginCard /> : null}
      {session ? (
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/admin">管理后台</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/me">申请 VK</Link>
          </Button>
        </div>
      ) : null}
    </Shell>
  );
}
