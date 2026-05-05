import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * shadcn/ui Sonner（Vite 无 next-themes：`theme="system"` 由 Sonner 自行跟随系统）。
 * @see https://ui.shadcn.com/docs/components/radix/sonner
 */
export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground"
        }
      }}
      {...props}
    />
  );
}
