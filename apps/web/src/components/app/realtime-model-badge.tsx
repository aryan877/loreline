import {
  LORELINE_REALTIME_MODEL_ID,
  LORELINE_REALTIME_MODEL_LABEL,
} from "@loreline/contracts/ai";
import { AudioLines } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function RealtimeModelBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      title={`OpenAI model: ${LORELINE_REALTIME_MODEL_ID}`}
      aria-label={`Voice model: ${LORELINE_REALTIME_MODEL_LABEL}`}
      className={cn(
        "h-6 gap-1.5 border-sky/35 bg-sky-soft/55 px-2 text-[0.65rem] font-semibold text-foreground shadow-sm",
        className,
      )}
    >
      <AudioLines className="text-sky" />
      {LORELINE_REALTIME_MODEL_LABEL}
    </Badge>
  );
}
