import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

export function DisclaimerBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="bg-chart-4/10 dark:bg-chart-4/15 border-b border-chart-4/20 px-4 py-1.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="w-3 h-3 text-chart-4 flex-shrink-0" />
        <span>For educational purposes only. Not financial advice. Past performance does not guarantee future results.</span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover-elevate rounded-md p-0.5"
        data-testid="button-dismiss-disclaimer"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
