import { Check } from "lucide-react";

/** Stages correspond to observable events, never an invented timer or predicted payout. */
export function SettlementRail({
  stage,
  expired = false,
}: {
  stage: 0 | 1 | 2 | 3;
  expired?: boolean;
}) {
  return (
    <ol className="settlement-rail" aria-label="Settlement progress">
      {["Deposit", expired ? "Expiry" : "Signed price", "Payout"].map(
        (label, i) => {
          const done = stage > i;
          const current = stage > 0 && stage === i && stage < 3;
          return (
            <li
              key={label}
              className={done ? "complete" : current ? "current" : ""}
              aria-current={current ? "step" : undefined}
            >
              <span className="settlement-node">
                {done ? <Check size={13} /> : <span />}
              </span>
              <span>{label}</span>
            </li>
          );
        },
      )}
    </ol>
  );
}
