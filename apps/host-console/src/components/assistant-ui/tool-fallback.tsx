type Props = {
  toolName?: string;
  args?: unknown;
};

export function ToolFallback({ toolName, args }: Props) {
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs">
      <p className="font-medium">Tool: {toolName ?? "unknown"}</p>
      <pre className="mt-1 overflow-auto whitespace-pre-wrap text-muted-foreground">
        {JSON.stringify(args ?? {}, null, 2)}
      </pre>
    </div>
  );
}
