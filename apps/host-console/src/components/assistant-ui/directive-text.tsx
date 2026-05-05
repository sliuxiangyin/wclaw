import type { ComponentPropsWithoutRef } from "react";

export function DirectiveText(props: ComponentPropsWithoutRef<"span">) {
  return <span {...props} />;
}
