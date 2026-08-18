import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import DocsPage from "./page";
import { allEndpoints, navGroups } from "./catalog";
import { SAMPLE_KEY, samplesFor } from "./spec";

function renderDocs(path = "/admin/docs") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/docs" element={<DocsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("admin API docs", () => {
  it("defaults to OpenAI chat completions", () => {
    renderDocs();
    expect(screen.getByRole("heading", { name: "接口文档" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "接口列表" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "对话补全" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "调用示例" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "响应" })).toBeInTheDocument();
    expect(screen.getByText("/v1/chat/completions")).toBeInTheDocument();
    expect(screen.getByText("Authorization", { selector: "span" })).toBeInTheDocument();
    expect(document.querySelector("pre")?.textContent).toContain(SAMPLE_KEY);
  });

  it("switches to Anthropic messages from the list", async () => {
    const user = userEvent.setup();
    renderDocs();
    await user.click(screen.getByRole("button", { name: /Messages/ }));
    expect(screen.getByRole("heading", { name: "Messages" })).toBeInTheDocument();
    expect(screen.getAllByText("/v1/messages").length).toBeGreaterThan(0);
    expect(screen.getByText("x-api-key", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("max_tokens", { selector: "span" })).toBeInTheDocument();
  });

  it("lists every Fabric API under categories", () => {
    renderDocs();
    const apiCount = navGroups.reduce(
      (n, g) => n + g.items.filter((i) => i.kind === "api").length,
      0,
    );
    expect(allEndpoints).toHaveLength(40);
    expect(apiCount).toBe(40);
    for (const title of [
      "模型 API",
      "系统",
      "账号",
      "企业",
      "项目",
      "虚拟钥匙",
      "上游 Provider",
      "Model 映射",
      "价格与用量",
      "参考",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /登录/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /健康检查/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /创建企业/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /创建用户/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /创建 Channel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /用量聚合/ })).toBeInTheDocument();
    expect(screen.queryByText("/console/v1/login")).not.toBeInTheDocument();
    expect(screen.queryByText("渠道池")).not.toBeInTheDocument();
  });

  it("opens a console API from the list", async () => {
    const user = userEvent.setup();
    renderDocs();
    await user.click(screen.getByRole("button", { name: /登录/ }));
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByText("/admin/api/login")).toBeInTheDocument();
    expect(screen.getAllByText("username", { selector: "span" }).length).toBeGreaterThan(0);
  });

  it("opens errors from the list", async () => {
    const user = userEvent.setup();
    renderDocs();
    await user.click(screen.getByRole("button", { name: "鉴权与错误" }));
    expect(screen.getByRole("heading", { name: "鉴权与错误" })).toBeInTheDocument();
    expect(screen.getByText("missing_virtual_key")).toBeInTheDocument();
    expect(screen.getByText("invalid_virtual_key")).toBeInTheDocument();
    expect(screen.getByText("unauthorized")).toBeInTheDocument();
  });

  it("opens errors from a deep link", () => {
    renderDocs("/admin/docs?api=errors");
    expect(screen.getByRole("heading", { name: "鉴权与错误" })).toBeInTheDocument();
    expect(screen.getByText("no_price")).toBeInTheDocument();
    expect(screen.getByText("project_id_not_supported")).toBeInTheDocument();
    expect(screen.getByText("team_mismatch")).toBeInTheDocument();
    expect(screen.getByText("enterprise_disabled")).toBeInTheDocument();
    expect(screen.getByText("rate_limited")).toBeInTheDocument();
    expect(screen.getByText("budget_exceeded")).toBeInTheDocument();
  });

  it("switches example language", async () => {
    const user = userEvent.setup();
    renderDocs();
    await user.click(screen.getByRole("button", { name: "Python" }));
    expect(screen.getByText(/from openai import OpenAI/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "JavaScript" }));
    expect(screen.getByText(/import OpenAI from "openai"/)).toBeInTheDocument();
  });

  it("expands nested message fields", async () => {
    const user = userEvent.setup();
    renderDocs();
    expect(screen.queryByText("enum<string>")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "messages" }));
    expect(screen.getByText("enum<string>")).toBeInTheDocument();
    expect(screen.getByText("role", { selector: "span, button" })).toBeInTheDocument();
  });

  it("copies the current example", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderDocs();
    await user.click(screen.getByTestId("copy-example"));
    const expected = samplesFor("chat", window.location.origin).curl.request;
    expect(writeText).toHaveBeenCalledWith(expected);
  });
});
