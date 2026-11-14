import React from "react";
import { cn } from "../lib/utils";

interface UaFlagProps {
  className?: string;
}

/** Crisp inline SVG Ukrainian flag — avoids Skia COLRv1 emoji crashes in older WebKitGTK AppImage builds. */
export const UaFlag: React.FC<UaFlagProps> = ({ className }) => (
  <svg
    viewBox="0 0 16 12"
    aria-label="UA"
    className={cn("w-4 h-3 rounded-[2px] shrink-0 inline-block", className)}
  >
    <rect width="16" height="6" fill="#005BBB" />
    <rect y="6" width="16" height="6" fill="#FFD500" />
  </svg>
);
