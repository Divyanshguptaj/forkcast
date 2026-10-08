import type { BadgeTone } from "@/components/shared/Badge";
import type { RestaurantPhase } from "@/lib/agent/types";

export const PHASE_COPY: Record<RestaurantPhase, { label: string; tone: BadgeTone; icon: string }> = {
  waiting: { label: "Waiting", tone: "neutral", icon: "⏳" },
  researching: { label: "Researching", tone: "saffron", icon: "🔍" },
  menu_found: { label: "Menu found", tone: "basil", icon: "📖" },
  menu_reading: { label: "Reading menu", tone: "saffron", icon: "📖" },
  menu_unreadable: { label: "Menu found, not readable", tone: "saffron", icon: "📖" },
  menu_unavailable: { label: "No menu online", tone: "neutral", icon: "📭" },
  review_research: { label: "Checking diners", tone: "saffron", icon: "💬" },
  complete: { label: "Research done", tone: "basil", icon: "✅" },
  degraded: { label: "Done, with gaps", tone: "saffron", icon: "🧩" },
  failed: { label: "Couldn't research", tone: "chili", icon: "⚠️" },
};
