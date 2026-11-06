import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Fragment, useEffect, useState } from "react";
import { deployment, explorerTx } from "../chain/deployment.ts";
import { TRIGGERS } from "../content/acts.ts";
import { units, utc } from "../format.ts";
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

const triggerNames = (mask: number) =>
  TRIGGERS.filter(([bit]) => mask & bit)
    .map(([, n]) => n)
    .join(" · ") || "none";

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
  const depositNow = p?.exact ? p.exact.deposit : null;
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

  return (
    <Card className="swap-card">
      <div className="swap-head">
        <h3 className="h3">{title}</h3>
        <WalletButton />
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
      <ToggleGroup
        className="seg swap-direction"
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
      <label className="swap-box" htmlFor="swap-in">
        <span className="tl">{exactOutput ? "You request" : "You pay"}</span>
        <span className="swap-row">
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
        </span>
        <span className="swap-meta">
          {p?.balanceIn !== null && p?.balanceIn !== undefined ? (
            <>
              Balance {fmt(p.balanceIn, tIn)}{" "}
              {!exactOutput && (
                <Button
                  type="button"
                  variant="link"
                  className="inline-action"
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
            </>
          ) : (
            "Connect a wallet to see your balance"
          )}
        </span>
      </label>

      <div className="swap-box out">
        <span className="tl">
          {exactOutput
            ? "Payment including deposit"
            : "You receive after deposit"}
        </span>
        <span className="swap-row">
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
        </span>
        <span className="swap-meta">
          {p?.exact
            ? "Simulated from your account"
            : "Estimate includes the hook"}
        </span>
      </div>

      {amount !== "" && f.specified === null && (
        <p className="err">
          Enter a positive amount with at most {specifiedToken.decimals}{" "}
          decimals.
        </p>
      )}
      {f.previewError && <p className="err">Quote failed: {f.previewError}</p>}

      {p && (
        <div className="kv swap-kv">
          <Row
            k="Price impact, LP fee included"
            v={`${(priceImpactBps(ctx, p) / 100).toFixed(2)}%`}
            em={priceImpactBps(ctx, p) > 100}
          />
          <Row
            k="Flagged if it executes now"
            v={p.deposit.flaggedNow ? "Yes" : "No"}
            em={p.deposit.flaggedNow}
          />
          <Row k="Triggers that fire" v={triggerNames(p.deposit.triggers)} />
          <Row
            k="Deposit held now"
            v={
              depositNow !== null
                ? fmt(depositNow, depositToken)
                : p.deposit.flaggedNow
                  ? `about ${fmt(p.depositBound, depositToken)}`
                  : fmt(0n, depositToken)
            }
            em={p.deposit.flaggedNow}
          />
          <Row
            k="Deposit rate"
            v={`${p.deposit.rateBps} bps of notional · ${p.deposit.mode === 1 ? "closure record" : "continuous"}`}
          />
          <Row
            k="Settles from (t₀)"
            v={p.deposit.flaggedNow ? utc(p.deposit.settleAfter) : "no record"}
          />
          <Row
            k="Refunded in full if unsettled by"
            v={p.deposit.flaggedNow ? utc(p.deposit.expiresAt) : "no record"}
          />
          <Row
            k="Licence exemption"
            v={p.deposit.exempt ? "Yes: this account holds the licence" : "No"}
          />
          {f.guard && (
            <>
              {exactOutput ? (
                <Row k="Guard: most you pay" v={fmt(f.guard.maxNetIn, tIn)} />
              ) : (
                <Row
                  k="Guard: least you receive"
                  v={fmt(f.guard.minNetOut, tOut)}
                />
              )}
              <Row
                k="Guard: most deposit accepted"
                v={fmt(f.guard.maxDeposit, depositToken)}
              />
            </>
          )}
        </div>
      )}

      <div className="swap-settings">
        <span className="tl">Slippage</span>
        <ToggleGroup
          aria-label="Slippage"
          value={[String(slippage)]}
          disabled={busy}
          onValueChange={(v) => {
            if (v[0]) setSlippage(BigInt(String(v[0])));
          }}
        >
          {SLIPPAGE_CHOICES.map(([label, bps]) => (
            <ToggleGroupItem key={label} value={String(bps)} className="opt">
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="tl">{`${Number(slippage) / Number(BPS / 100n)}% ${exactOutput ? "above" : "below"} the quote reverts on chain`}</span>
      </div>

      <Button
        className=" swap-go"
        onClick={action.onClick}
        disabled={action.disabled}
      >
        {action.label}
      </Button>
      {p?.exactError && (
        <p className="err">
          Simulation from your account failed: {p.exactError}
        </p>
      )}
      {f.actionError && (
        <p className="err" role="alert">
          {f.actionError}
        </p>
      )}
      {f.result && (
        <div className="swap-done" role="status">
          <p className="tl">
            Confirmed in block {f.result.receipt.blockNumber.toString()}
          </p>
          <p className="body">
            Paid <b className="mono">{fmt(f.result.paid, tIn)}</b>, received{" "}
            <b className="mono">{fmt(f.result.received, tOut)}</b>
            {f.result.record ? (
              <>
                , and{" "}
                <b className="mono">
                  {fmt(f.result.record.deposit, depositToken)}
                </b>{" "}
                is held as record #{f.result.record.id.toString()} until it
                settles.
              </>
            ) : (
              ". Not flagged: no deposit was taken."
            )}
          </p>
          <p className="src">
            <a
              href={explorerTx(f.result.hash)}
              target="_blank"
              rel="noreferrer"
            >
              View the transaction
            </a>{" "}
            ·{" "}
            <Button variant="link" className="inline-action" onClick={f.reset}>
              New swap
            </Button>
          </p>
        </div>
      )}
      {exactOutput && (
        <p className="src">
          The router caps payment and deposit. If liquidity changes before
          inclusion, the pool can fill less than the requested output.
        </p>
      )}
      <p className="src">
        Testnet only. The guard reverts the swap if the deposit exceeds its cap
        or{" "}
        {exactOutput
          ? "the payment exceeds your maximum"
          : "the output falls below your minimum"}
        .
      </p>
    </Card>
  );
}
