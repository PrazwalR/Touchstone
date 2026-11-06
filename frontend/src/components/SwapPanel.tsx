import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { ArrowDown, LoaderCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Fragment, useEffect, useState } from "react";
import { deployment, explorerTx } from "../chain/deployment.ts";
import { units } from "../format.ts";
import {
  BPS,
  isNative,
  priceImpactBps,
  tokenIn,
  tokenOut,
  type Side,
  type SwapContext,
  type SwapResult,
} from "../swap/swap.ts";
import { useSwapFlow } from "../swap/useSwapFlow.ts";
import { WalletButton } from "./WalletButton.tsx";

const SLIPPAGE_CHOICES: [string, bigint][] = [
  ["0.1%", 10n],
  ["0.5%", 50n],
  ["1%", 100n],
];
/** Native ETH kept back from MAX for gas. */
const GAS_RESERVE_WEI = 10n ** 15n;

function Row({ k, v, em }: { k: string; v: string; em?: boolean }) {
  return (
    <Fragment>
      <div>{k}</div>
      <div className={`v ${em ? "em" : ""}`}>{v}</div>
    </Fragment>
  );
}

/**
 * A DEX-style swap through GuardedRouter (decision 0060). Without a wallet it still quotes; with one it approves
 * exactly the input, simulates, and sends swapGuarded with a guard computed from a fresh simulation.
 */
export function SwapPanel({
  ctx,
  initialSide = "buy",
  initialAmount = "",
  onSwapped,
  title = "Swap",
}: {
  ctx: SwapContext;
  initialSide?: Side;
  initialAmount?: string;
  onSwapped?: (r: SwapResult) => void;
  title?: string;
}) {
  const [side, setSide] = useState<Side>(initialSide);
  const [amount, setAmount] = useState(initialAmount);
  const [slippage, setSlippage] = useState<bigint>(50n);
  const [exactOutput, setExactOutput] = useState(false);
  const f = useSwapFlow(ctx, side, amount, slippage, exactOutput);
  const tIn = tokenIn(ctx, side);
  const tOut = tokenOut(ctx, side);
  const specifiedToken = exactOutput ? tOut : tIn;
  const depositToken = exactOutput ? tIn : tOut;
  const p = f.preview;
  const fmt = (v: bigint, t: typeof tIn) =>
    `${units(v, t.decimals, t.decimals > 6 ? 6 : 2)} ${t.symbol}`;

  useEffect(() => {
    if (f.phase === "done" && f.result) onSwapped?.(f.result);
  }, [f.phase, f.result, onSwapped]);

  const netOut = p?.exact?.netOut ?? p?.netOut ?? null;
  const insufficient =
    p?.balanceIn !== null &&
    p?.balanceIn !== undefined &&
    f.guard &&
    p.balanceIn < f.guard.maxNetIn;
  const busy =
    f.phase === "approving" ||
    f.phase === "signing" ||
    f.phase === "confirming";

  let action: { label: string; onClick?: () => void; disabled: boolean } = {
    label: "Enter an amount",
    disabled: true,
  };
  if (!f.wallet.account)
    action = { label: "Connect a wallet to swap", disabled: true };
  else if (!f.wallet.onRightChain)
    action = {
      label: `Switch to ${deployment.name}`,
      onClick: () => void f.wallet.switchToDeployment(),
      disabled: false,
    };
  else if (f.specified === null)
    action = { label: "Enter an amount", disabled: true };
  else if (!p)
    action = { label: f.loading ? "Quoting…" : "No quote", disabled: true };
  else if (insufficient)
    action = { label: `Not enough ${tIn.symbol}`, disabled: true };
  else if (f.guard && p.allowance !== null && p.allowance < f.guard.maxNetIn)
    action = {
      label:
        f.phase === "approving"
          ? "Approving in the wallet…"
          : `Approve exactly ${fmt(f.guard.maxNetIn, tIn)}`,
      onClick: () => void f.approve(),
      disabled: busy,
    };
  else if (p.exactError)
    action = { label: "The swap would revert", disabled: true };
  else
    action = {
      label: f.phase === "signing" ? "Confirm in the wallet…" : "Swap",
      onClick: () => void f.swap(),
      disabled: busy || !f.guard,
    };

  const impact = p ? priceImpactBps(ctx, p) : null;
  const impactText = impact === null ? "—" : `${(impact / 100).toFixed(2)}%`;
  if (busy)
    action = {
      label:
        f.phase === "approving"
          ? "Approving in wallet…"
          : f.phase === "confirming"
            ? "Confirming swap…"
            : "Submitting swap…",
      disabled: true,
    };
  else if (f.phase === "done" && f.result)
    action = { label: "New swap", onClick: f.reset, disabled: false };

  return (
    <Card className="swap-card demo-trade">
      <div className="swap-head">
        <h2>{title}</h2>
        {f.wallet.account && <WalletButton />}
      </div>
      <ToggleGroup
        className="seg swap-direction"
        aria-label="Direction"
        value={[side]}
        disabled={busy}
        onValueChange={(v) => {
          if (v[0] && v[0] !== side) {
            setSide(v[0] as Side);
            f.reset();
          }
        }}
      >
        {(["buy", "sell"] as const).map((value) => (
          <ToggleGroupItem key={value} value={value} className="opt">
            {value === "buy"
              ? `Buy ${ctx.risky.symbol}`
              : `Sell ${ctx.risky.symbol}`}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="trade-amounts">
        <div className="swap-box">
          <label htmlFor="swap-in">
            {exactOutput ? "You request" : "You pay"}
          </label>
          <div className="swap-row">
            <Input
              id="swap-in"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              aria-invalid={amount !== "" && f.specified === null}
              disabled={busy}
            />
            <span className="token">{specifiedToken.symbol}</span>
          </div>
          {p?.balanceIn !== null && p?.balanceIn !== undefined && (
            <div className="swap-meta">
              Balance {fmt(p.balanceIn, tIn)}{" "}
              {!exactOutput && (
                <Button
                  type="button"
                  variant="link"
                  className="inline-action"
                  disabled={busy}
                  onClick={() => {
                    const max = isNative(tIn)
                      ? p.balanceIn! > GAS_RESERVE_WEI
                        ? p.balanceIn! - GAS_RESERVE_WEI
                        : 0n
                      : p.balanceIn!;
                    setAmount(
                      units(max, tIn.decimals, tIn.decimals).replace(/,/g, ""),
                    );
                  }}
                >
                  Max
                </Button>
              )}
            </div>
          )}
        </div>
        <span className="trade-arrow" aria-hidden="true">
          <ArrowDown size={15} />
        </span>
        <div className="swap-box out">
          <span className="amount-label">
            {exactOutput ? "You pay" : "You receive"}
          </span>
          <div className="swap-row">
            <output className="swap-out">
              {p && exactOutput
                ? units(
                    p.exact?.netIn ?? p.amountIn,
                    tIn.decimals,
                    tIn.decimals > 6 ? 6 : 2,
                  )
                : netOut === null
                  ? "—"
                  : units(netOut, tOut.decimals, tOut.decimals > 6 ? 6 : 2)}
            </output>
            <span className="token">
              {exactOutput ? tIn.symbol : tOut.symbol}
            </span>
          </div>
          <span className="swap-meta">
            {f.loading
              ? "Refreshing quote…"
              : p?.exact
                ? exactOutput ? "Estimated payment, including any hold" : "Estimated immediate output"
                : exactOutput
                  ? "Estimated payment, including any hold"
                  : "Estimated immediate output"}
          </span>
        </div>
      </div>
      {amount !== "" && f.specified === null && (
        <p className="demo-error" role="alert">
          Enter a positive amount with at most {specifiedToken.decimals}{" "}
          decimals.
        </p>
      )}
      {f.previewError && (
        <p className="demo-error" role="alert">
          Quote unavailable: {f.previewError}
        </p>
      )}
      <div className="trade-essentials">
        {f.guard && (
          <>
            <span>{exactOutput ? "Maximum payment" : "Minimum received"}</span>
            <strong>
              {exactOutput
                ? fmt(f.guard.maxNetIn, tIn)
                : fmt(f.guard.minNetOut, tOut)}
            </strong>
          </>
        )}
      </div>
      {exactOutput && (
        <p className="swap-meta">
          Output may be partially filled if liquidity changes.
        </p>
      )}
      {!f.wallet.account ? (
        <WalletButton prominent />
      ) : (
        <Button
          className="swap-go"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {busy && <LoaderCircle className="demo-spin" size={17} />}
          {action.label}
        </Button>
      )}
      {p?.exactError && (
        <p className="demo-error" role="alert">
          Your swap would revert: {p.exactError}
        </p>
      )}
      {f.actionError && (
        <p className="demo-error" role="alert">
          {f.actionError}
        </p>
      )}
      {f.result && (
        <div className="trade-confirmed" role="status">
          <span>{f.result.record ? "Swap complete · deposit recorded" : "Swap complete · no deposit"}</span>
          <a href={explorerTx(f.result.hash)} target="_blank" rel="noreferrer">
            View transaction ↗
          </a>
          <p>
            Paid {fmt(f.result.paid, tIn)} · received{" "}
            {fmt(f.result.received, tOut)} · block{" "}
            {f.result.receipt.blockNumber.toString()}
          </p>
          <p>
            {f.result.record
              ? `${fmt(f.result.record.deposit, depositToken)} was held by the hook during execution. Follow its refund in the settlement panel.`
              : "The hook collected no deposit during execution. There is nothing to settle."}
          </p>
          {f.result.record && (
            <p>
              {f.result.record.mode === 1
                ? "Reason: this trade was recorded in closed-market mode."
                : "The deposit requirement was confirmed on-chain. This deployment does not record which individual trigger fired."}
            </p>
          )}
        </div>
      )}
      <Accordion className="trade-details">
        <AccordionItem value="settings">
          <AccordionTrigger>
            <span>Trade settings</span>
            <span className="detail-summary">
              {exactOutput ? "Exact output" : "Exact input"} ·{" "}
              {Number(slippage) / Number(BPS / 100n)}%
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="trade-setting">
              <span>Amount to specify</span>
              <ToggleGroup
                aria-label="Amount to specify"
                value={[exactOutput ? "output" : "input"]}
                disabled={busy}
                onValueChange={(v) => {
                  if (v[0] && (v[0] === "output") !== exactOutput) {
                    setExactOutput(v[0] === "output");
                    setAmount("");
                    f.reset();
                  }
                }}
              >
                <ToggleGroupItem value="input" className="opt">
                  Exact input
                </ToggleGroupItem>
                <ToggleGroupItem value="output" className="opt">
                  Exact output
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="trade-setting">
              <span>Slippage tolerance</span>
              <ToggleGroup
                aria-label="Slippage"
                value={[String(slippage)]}
                disabled={busy}
                onValueChange={(v) => {
                  if (v[0]) setSlippage(BigInt(String(v[0])));
                }}
              >
                {SLIPPAGE_CHOICES.map(([label, bps]) => (
                  <ToggleGroupItem
                    key={label}
                    value={String(bps)}
                    className="opt"
                  >
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <p className="swap-meta">
              The swap reverts if{" "}
              {exactOutput
                ? "payment exceeds your maximum"
                : "output falls below your minimum"}{" "}
              or the deposit exceeds its cap.
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="quote">
          <AccordionTrigger>Quote details</AccordionTrigger>
          <AccordionContent>
            <p className="swap-meta">
              The displayed output includes any hold estimated under current
              state. The hook decides whether to collect a refundable deposit
              during execution. Your minimum output, maximum payment and deposit
              cap are enforced on-chain.
            </p>
            {p ? (
              <>
                <div className="kv swap-kv">
                  <Row k="Price impact" v={impactText} />
                  {f.guard && (
                    <Row
                      k="Maximum deposit accepted"
                      v={fmt(f.guard.maxDeposit, depositToken)}
                    />
                  )}
                  <Row k="Quote block" v={p.blockNumber.toString()} />
                  <Row
                    k="Quote source"
                    v={p.exact ? "Account simulation" : "Uniswap V4Quoter"}
                  />
                </div>
                <p className="swap-meta">
                  Price impact is the difference from the pool’s current price
                  caused by execution against its liquidity, including the LP fee.
                  It does not determine whether a deposit was collected.
                </p>
                {impact !== null && impact > 100 && (
                  <p className="impact-note">
                    High price impact. This testnet pool has limited liquidity.
                  </p>
                )}
              </>
            ) : (
              <p className="swap-meta">
                {f.loading
                  ? "Reading quote…"
                  : f.specified === null
                    ? "Enter an amount to read a quote."
                    : "Quote unavailable. Check the message above."}
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
