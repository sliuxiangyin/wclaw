import { useMemo, useState, type ReactNode } from "react";
import { MessagePartPrimitive } from "@assistant-ui/react";

type ReasoningRootProps = {
  defaultOpen?: boolean;
  variant?: "outline" | "ghost" | "muted";
  children: ReactNode;
};

export function ReasoningRoot({ defaultOpen = false, variant = "outline", children }: ReasoningRootProps) {
  const [open, setOpen] = useState(defaultOpen);
  const variantClass = useMemo(() => {
    if (variant === "ghost") return "";
    if (variant === "muted") return "bg-muted/50";
    return "border border-border/60 bg-background/60";
  }, [variant]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className={`mt-2 overflow-hidden rounded-md ${variantClass}`}
    >
      {children}
    </details>
  );
}

export function ReasoningTrigger({ active = false }: { active?: boolean }) {
  return (
    <summary className="cursor-pointer list-none px-2 py-1.5 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
      <span className="inline-flex items-center gap-1.5">
        <span className={`inline-block size-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-muted-foreground/60"}`} />
        思考过程
      </span>
    </summary>
  );
}

export function ReasoningContent({
  children,
  ...props
}: {
  children: ReactNode;
  "aria-busy"?: boolean;
}) {
  return (
    <div className="border-t border-border/50 px-2 py-1.5" {...props}>
      {children}
    </div>
  );
}

export function ReasoningText({ children }: { children: ReactNode }) {
  return <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{children}</div>;
}

export function Reasoning() {
  return (
    <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
      <MessagePartPrimitive.Text />
    </div>
  );
}
