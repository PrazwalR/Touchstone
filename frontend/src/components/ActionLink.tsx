import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

/** The preset's button, with native link navigation and keyboard behavior. */
export function ActionLink({
  variant = "outline",
  ...props
}: ComponentProps<"a"> & { variant?: "default" | "outline" | "ghost" }) {
  return (
    <Button
      variant={variant}
      size="lg"
      nativeButton={false}
      role="link"
      render={<a {...props} />}
    />
  );
}
