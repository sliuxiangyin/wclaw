"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export type AskUserToChooseToolArgs = {
  question?: string;
  options?: string[];
};

const AskUserToChooseRender: ToolCallMessagePartComponent<
  AskUserToChooseToolArgs,
  { selected: string }
> = ({ args, status, addResult }) => {
  const question = typeof args?.question === "string" && args.question.trim() ? args.question : "请选择一个选项：";
  const options = Array.isArray(args?.options)
    ? args.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
    : [];

  const busy = status.type === "running";
  const settled = status.type === "complete";

  if (settled) {
    return (
      <Card className="mt-2 border-border/80 bg-muted/40">
        <CardHeader className="space-y-1 py-3">
          <CardTitle className="text-sm font-medium">已选择</CardTitle>
          <CardDescription className="text-xs">选项已提交，可继续对话。</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (options.length === 0) {
    return (
      <Card className="mt-2 border-dashed border-amber-500/40 bg-amber-500/5">
        <CardContent className="py-3 text-xs text-muted-foreground">
          工具 <code className="rounded bg-muted px-1 py-px">ask_user_to_choose</code>{" "}
          未提供有效 <code className="rounded bg-muted px-1 py-px">options</code>。
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-2 border-primary/25 bg-card shadow-sm">
      <CardHeader className="space-y-2 py-3">
        <CardTitle className="text-sm font-semibold leading-snug">请选择</CardTitle>
        <Label className="text-xs font-normal text-muted-foreground">{question}</Label>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pb-4 pt-0 sm:flex-row sm:flex-wrap">
        {options.map((opt) => (
          <Button
            key={opt}
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            className="justify-start text-left font-normal"
            onClick={() => void addResult({ selected: opt })}
          >
           222 {opt}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
};

/**
 * 仅 UI：当消息流中出现 <code>ask_user_to_choose</code> 工具片段时使用（与 Ink 侧
 * {@link https://www.assistant-ui.com/docs/ink/hooks?platform=ink#makeassistanttoolui makeAssistantToolUI}
 * 概念一致，Web 包为 <code>@assistant-ui/react</code>）。
 */
export const AskUserToChooseToolUI = makeAssistantToolUI({
  toolName: "ask_user_to_choose",
  render: AskUserToChooseRender,
 
});
