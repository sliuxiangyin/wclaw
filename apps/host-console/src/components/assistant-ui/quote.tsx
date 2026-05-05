import type { ComponentPropsWithoutRef } from "react";

export function ComposerQuotePreview() {
  return null;
}

export function SelectionToolbar() {
  return null;
}

type QuoteBlockProps = ComponentPropsWithoutRef<"blockquote">;

export function QuoteBlock(props: QuoteBlockProps) {
  return <blockquote className="border-l-2 border-border pl-3 text-muted-foreground" {...props} />;
}
