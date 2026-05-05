import type { McpServerSummaryDto } from "@/lib/api/mcp.api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Props = {
  item: McpServerSummaryDto;
};

export function McpServerToolsPopover({ item }: Props) {
  const tools = item.status.tools;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
          title="查看工具列表"
        >
          {tools.length} tools enabled
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" sideOffset={6} className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          {item.displayName || item.id}
        </div>
        <ul className="max-h-[min(20rem,calc(100vh-12rem))] overflow-y-auto p-2">
          {tools.length === 0 ? (
            <li className="rounded-md px-2 py-6 text-center text-xs text-muted-foreground">
              暂无工具记录。请先启用该 Server，并点击「探测工具」。
            </li>
          ) : (
            tools.map((t) => (
              <li key={t.name} className="rounded-md px-2 py-1.5 hover:bg-muted/60">
                <div className="font-mono text-xs font-semibold">{t.name}</div>
                {t.description ? (
                  <div className="mt-1 text-xs leading-snug text-muted-foreground wrap-break-word">{t.description}</div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
