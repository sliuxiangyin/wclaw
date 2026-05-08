"use client";

import { memo, useCallback, useRef, useState } from "react";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  LoaderIcon,
  XCircleIcon,
} from "lucide-react";
import {
  useScrollLock,
  type ToolCallMessagePartStatus,
} from "@assistant-ui/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;
type ToolStatus = ToolCallMessagePartStatus["type"];

const statusIconMap: Record<ToolStatus, React.ElementType> = {
  running: LoaderIcon,
  complete: CheckIcon,
  incomplete: XCircleIcon,
  "requires-action": AlertCircleIcon,
};

function getResultErrorText(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const candidate = (result as { isError?: unknown; content?: unknown }).isError;
  if (candidate !== true) return null;
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const text = (item as { type?: unknown; text?: unknown }).text;
      const type = (item as { type?: unknown }).type;
      if (type === "text" && typeof text === "string" && text.trim()) return text;
    }
  }
  return "Plugin execution failed";
}

type PluginFallbackProps = {
  toolName: string;
  argsText?: string;
  result?: unknown;
  status?: ToolCallMessagePartStatus;
  [key: string]: unknown;
};

const PluginFallbackImpl = ({
  toolName,
  argsText,
  result,
  status,
}: PluginFallbackProps) => {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) lockScroll();
      setOpen(nextOpen);
    },
    [lockScroll],
  );

  const resultErrorText = getResultErrorText(result);
  const hasResultError = !!resultErrorText;
  const statusType: ToolStatus = hasResultError ? "incomplete" : (status?.type ?? "complete");
  const isRunning = statusType === "running";
  const isCancelled = status?.type === "incomplete" && status.reason === "cancelled";
  const isFailed = hasResultError || (statusType === "incomplete" && !isCancelled);
  const Icon = statusIconMap[statusType];
  const label = isCancelled
    ? "Cancelled plugin"
    : isFailed
      ? "Failed plugin"
      : "Used plugin";

  const statusError =
    status?.type === "incomplete"
      ? status.error
        ? typeof status.error === "string"
          ? status.error
          : JSON.stringify(status.error)
        : null
      : null;
  const errorText = statusError ?? resultErrorText;

  return (
    <Collapsible
      ref={collapsibleRef}
      open={open}
      onOpenChange={handleOpenChange}
      className={cn(
        "w-full rounded-lg border py-3",
        isCancelled && "border-muted-foreground/30 bg-muted/30",
        isFailed && "border-red-500/40 bg-red-500/5",
      )}
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties}
    >
      <CollapsibleTrigger className="group/trigger flex w-full items-center gap-2 px-4 text-sm transition-colors">
        <Icon
          className={cn(
            "size-4 shrink-0",
            isCancelled && "text-muted-foreground",
            isFailed && "text-red-500",
            isRunning && "animate-spin",
          )}
        />
        <span
          className={cn(
            "relative inline-block grow text-start leading-none",
            isCancelled && "text-muted-foreground line-through",
          )}
        >
          <span>
            {label}: <b>{toolName}</b>
          </span>
          {isRunning && (
            <span
              aria-hidden
              className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
            >
              {label}: <b>{toolName}</b>
            </span>
          )}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 transition-transform duration-(--animation-duration) ease-out",
            "group-data-[state=closed]/trigger:-rotate-90",
            "group-data-[state=open]/trigger:rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn(
          "relative overflow-hidden text-sm outline-none",
          "group/collapsible-content ease-out",
          "data-[state=closed]:animate-collapsible-up",
          "data-[state=open]:animate-collapsible-down",
          "data-[state=closed]:fill-mode-forwards",
          "data-[state=closed]:pointer-events-none",
          "data-[state=open]:duration-(--animation-duration)",
          "data-[state=closed]:duration-(--animation-duration)",
        )}
      >
        <div className="mt-3 flex flex-col gap-2 border-t pt-2">
          {errorText ? (
            <div className="px-4">
              <p className={cn("font-semibold", isCancelled ? "text-muted-foreground" : "text-red-500")}>
                {isCancelled ? "Cancelled reason:" : "Error:"}
              </p>
              <p className={cn(isCancelled ? "text-muted-foreground" : "text-red-500/90")}>{errorText}</p>
            </div>
          ) : null}
          {argsText ? (
            <div className={cn("px-4", isCancelled && "opacity-60")}>
              <pre className="whitespace-pre-wrap">{argsText}</pre>
            </div>
          ) : null}
          {!isCancelled && result !== undefined ? (
            <div className="border-t border-dashed px-4 pt-2">
              <p className="font-semibold">Result:</p>
              <pre className="whitespace-pre-wrap">
                {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export const PluginFallback = memo(PluginFallbackImpl);
