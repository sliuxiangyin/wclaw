import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<typeof Button> & {
  tooltip?: string;
};

export function TooltipIconButton({ tooltip, className, ...props }: Props) {
  return <Button title={tooltip} className={cn("size-8", className)} {...props} />;
}
