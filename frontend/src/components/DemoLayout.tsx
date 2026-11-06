import { POLL_MS } from "../config.ts";
import type { ReactNode } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { deployment, explorerTx } from "../chain/deployment.ts";
import type { Live } from "../chain/useLive.ts";
import type { SwapContext, SwapResult } from "../swap/swap.ts";
import type { TrackedRecord } from "../swap/useSwapFlow.ts";
import { href } from "../router.ts";
import { RecordTracker } from "./RecordTracker.tsx";
import { SettlementRail } from "./SettlementRail.tsx";

export function DemoHeader({
  id,
  title,
  live,
  next,
}: {
  id: string;
  title: string;
  live: Live;
  next: "swap" | "simulation";
}) {
  const delayed =
    Boolean(live.error) ||
    (live.readAt !== null && Date.now() - live.readAt > POLL_MS * 3);
  return (
    <div className="demo-header">
      <div>
        <h1 id={id}>{title}</h1>
        <p className="demo-network">
          <span
            className={`state-dot ${delayed ? "stale" : live.snapshot ? "fresh" : ""}`}
            aria-hidden="true"
          />
          {deployment.name} · testnet
          {delayed
            ? live.snapshot
              ? " · data delayed"
              : " · read unavailable"
            : ""}
        </p>
      </div>
      <a className="demo-other" href={href(next)}>
        {next === "swap" ? "Open swap" : "Follow an arbitrage"}
        <ArrowRight size={16} />
      </a>
    </div>
  );
}

export function SettlementPanel({
  ctx,
  tracked,
  onChange,
  result,
  live,
  onFollow,
  following,
  followError,
}: {
  ctx: SwapContext;
  tracked: TrackedRecord | null;
  onChange(t: TrackedRecord): void;
  result: SwapResult | null;
  live: Live;
  onFollow?: () => void;
  following?: boolean;
  followError?: string | null;
}) {
  const cfg = live.snapshot?.config;
  if (tracked)
    return (
      <RecordTracker
        ctx={ctx}
        tracked={tracked}
        onChange={onChange}
        {...(cfg
          ? { settleDelay: cfg.settleDelay, windowSeconds: cfg.window }
          : {})}
      />
    );
  const unflagged = result && !result.record;
  return (
    <Card className="settlement-card settlement-waiting">
      <div className="receipt-head">
        <h2>Settlement</h2>
        <span className="receipt-state">
          {unflagged ? "No deposit needed" : "Awaiting a trade"}
        </span>
      </div>
      <SettlementRail stage={0} />
      <div className="settlement-empty">
        {unflagged && (
          <div className="receipt-symbol confirmed" aria-hidden="true">
            <Check size={26} />
          </div>
        )}
        <h3>
          {unflagged ? "Swap confirmed. No deposit." : "Follow the deposit."}
        </h3>
        <p>
          {unflagged
            ? "This swap wasn’t flagged. No deposit was taken and there is nothing to settle."
            : "A flagged swap opens a record. A signed price determines the refund and the share returned to liquidity providers."}
        </p>
        {unflagged && (
          <a
            className="receipt-link"
            href={explorerTx(result.hash)}
            target="_blank"
            rel="noreferrer"
          >
            View confirmed swap <ArrowRight size={15} />
          </a>
        )}
      </div>
      <div className="receipt-bottom">
        {onFollow ? (
          <>
            <p>Presenting without a wallet?</p>
            <Button variant="outline" disabled={following} onClick={onFollow}>
              {following && <LoaderCircle className="demo-spin" size={15} />}
              {following ? "Finding a record…" : "Follow latest record"}
            </Button>
          </>
        ) : (
          <p>
            If a record isn’t settled before its deadline, it can expire for a
            full deposit refund.
          </p>
        )}
        {followError && (
          <p className="demo-error" role="alert">
            {followError}
          </p>
        )}
      </div>
    </Card>
  );
}

export function DemoDisclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Accordion className="demo-disclosure">
      <AccordionItem value="details">
        <AccordionTrigger>{title}</AccordionTrigger>
        <AccordionContent>{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
