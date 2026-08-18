import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { isTeamAdmin } from "@/lib/labels";
import { adminApi } from "@/lib/api";
import { errMsg } from "@/lib/error";

export default function MembersPage() {
  const { operator } = useAuth();
  const canAdd = isTeamAdmin(operator?.role);
  const [team, setTeam] = useState("");
  const [username, setUsername] = useState("");

  return (
    <div>
      <PageHeader title="成员" description="团队管理员可在本 Team 加开发者。" />
      {canAdd ? (
        <form
          className="max-w-sm space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await adminApi.addMember(team, username);
              toast.success("已加入");
              setUsername("");
            } catch (err) {
              toast.error(errMsg(err));
            }
          }}
        >
          <Input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team" />
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="开发者用户名" />
          <Button type="submit">加开发者</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">开发者不能加成员。</p>
      )}
    </div>
  );
}
