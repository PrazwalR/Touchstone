import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useEffect, useState } from "react";
import { deployment } from "../chain/deployment.ts";
import {
  E1,
  E2,
  E6,
  ENGINEERING,
  EXPERIMENTS,
  type Status,
} from "../content/evidence.ts";
import { Markdown } from "../docs/markdown.tsx";
import { href } from "../router.ts";
import { Contracts } from "../sections/Testnet.tsx";

// Each document is its own lazily loaded chunk. The specification itself is not bundled: it is private, and a
// hosted build would publish whatever it contains.
const lessons = import.meta.glob<string>("../../../docs/lessons/*.md", {
  query: "?raw",
  import: "default",
});
const decisions = import.meta.glob<string>("../../../docs/decisions/*.md", {
  query: "?raw",
  import: "default",
});
const singles: Record<string, [string, () => Promise<string>]> = {
  results: [
    "Research results write-up",
    () =>
      import("../../../research/results/README.md?raw").then((m) => m.default),
  ],
  runbook: [
    "Runbook",
    () => import("../../../docs/runbook.md?raw").then((m) => m.default),
  ],
  gas: [
    "Gas measurements",
    () => import("../../../docs/gas.md?raw").then((m) => m.default),
  ],
  threats: [
    "Threat model",
    () => import("../../../docs/threat-model.md?raw").then((m) => m.default),
  ],
  deployments: [
    "Deployments",
    () => import("../../../DEPLOYMENTS.md?raw").then((m) => m.default),
  ],
};

const slug = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");
const title = (s: string) => {
  const t = s.replace(/^\d+-/, "").replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const LESSONS = Object.keys(lessons)
  .sort()
  .map((p) => ({ slug: slug(p), path: p }));
const DECISIONS = Object.keys(decisions)
  .sort()
  .map((p) => ({ slug: slug(p), path: p }));

/** Links between the repository's docs open inside the reader; other relative links stay text. */
function resolveLink(target: string): string | null {
  if (/^(https?:|mailto:|#)/i.test(target)) return target;
  const decision = target.match(/(\d{4}-[\w-]+)\.md/);
  if (decision && DECISIONS.some((d) => d.slug === decision[1]))
    return href("docs", `decisions/${decision[1]}`);
  const lesson = target.match(/(\d{2}-[\w-]+)\.md/);
  if (lesson && LESSONS.some((l) => l.slug === lesson[1]))
    return href("docs", `lessons/${lesson[1]}`);
  return null;
}

function Doc({ load }: { load: () => Promise<string> }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(false);
    load().then(
      (t) => !cancelled && setText(t),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, [load]);
  if (error) return <p className="err">This document could not be loaded.</p>;
  if (text === null) return <p className="empty">Loading…</p>;
  return <Markdown source={text} resolveLink={resolveLink} />;
}

const STATUS_CHIP: Record<Status, string> = {
  passed: "chip-impl",
  killed: "chip-none",
  "partly measured": "chip-spec",
  "pre-registered": "chip-spec",
  drafted: "chip-spec",
  "not started": "chip-none",
  skipped: "chip-none",
};

const pct = (x: number, places = 1) => `${(x * 100).toFixed(places)}%`;

function Overview() {
  return (
    <div className="md">
      <h2>What Touchstone is</h2>
      <p>
        Touchstone is a Uniswap v4 hook that makes arbitrage against a pool pay
        the pool's LPs, without changing the price any trader gets. When a swap
        looks like the kind that profits from information the pool lacks (large,
        first in its block, part of fast flow, or toward a stale price), the
        hook takes a refundable deposit in the output token for exact-input
        swaps or in the payment token for exact-output swaps. A few seconds
        later, anyone can settle it against a signed Pyth price: if the trade
        was informed, part of the deposit goes to LPs; if it was benign, the
        trader is refunded in full and earns a rebate.
      </p>
      <p>
        Around that core sit closed-market mode for tokenised stocks (settling
        weekend trades at the reopen), an arbitrage licence auctioned to a
        holder who swaps exempt inside a price band and pays rent to LPs, and
        quote integrity: previewDeposit, URC-4 quotes and a guarded router make
        the deposit visible before and inside the transaction.
      </p>
      <h2>What is proven, and how</h2>
      <ul>
        <li>
          <strong>The trigger catches toxic flow.</strong> On held-out Ethereum
          mainnet data, it flags swaps carrying {pct(E2.recall)} of toxic
          markout (gate G1 passed). <em>Historical backtest.</em>
        </li>
        <li>
          <strong>The contracts do what the spec says.</strong> 254 contract
          tests, invariant runs, Slither reviewed, gas measured.{" "}
          <em>Measured.</em>
        </li>
        <li>
          <strong>It runs end to end.</strong> Deployed on {deployment.name};
          the Simulation tab runs a real swap through settlement.{" "}
          <em>Testnet demonstration</em>, which says nothing about LP returns.
        </li>
        <li>
          <strong>E6 hit its freshness kill line.</strong> In all {E6.cases}{" "}
          registered cases the pool was staler than the static-fee pool in both
          windows. <em>Simulation.</em> LP net returns remain unmeasured.
        </li>
      </ul>
      <p>
        Independent project; Uniswap Labs and the Uniswap Foundation have not
        endorsed, funded or reviewed it. Ex-post settlement is not new:
        Hindsight (UHI10) did it first, against the pool's own TWAP.
      </p>
    </div>
  );
}

function Research() {
  return (
    <div className="md">
      <h2>Research and evidence</h2>
      <p>
        Every experiment is pre-registered with a pass or kill line before its
        data is read; the hashes of the pre-registration, the analysis code and
        every input file are recorded with each result. Labels follow the
        project's rule: <strong>historical backtest</strong>,{" "}
        <strong>simulation</strong>, <strong>measured</strong>,{" "}
        <strong>testnet demonstration</strong> or <em>target</em>.
      </p>
      <h3>E2: does the trigger catch toxic flow? Gate G1</h3>
      <p className="tl">
        Historical backtest · {E2.window} · {E2.swaps.toLocaleString("en-US")}{" "}
        swaps
      </p>
      <div className="figs">
        <div>
          <b>{pct(E2.recall)}</b>
          <span>
            held-out recall of toxic markout (95% interval {pct(E2.recallCi[0])}{" "}
            to {pct(E2.recallCi[1])})
          </span>
        </div>
        <div>
          <b>{E2.phiCount.toFixed(3)}</b>
          <span>share of swaps flagged (gate: at most 0.30)</span>
        </div>
        <div>
          <b>{pct(E2.phiVolume, 0)}</b>
          <span>share of volume that would post a refundable deposit</span>
        </div>
        <div>
          <b>Pass</b>
          <span>verdict under the pre-registered rule</span>
        </div>
      </div>
      <ul>
        {E2.caveats.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p className="tl">
        Pre-registration {E2.prereg.slice(0, 12)}… · analysis code{" "}
        {E2.code.slice(0, 12)}…
      </p>
      <h3>E6 freshness</h3>
      <p className="tl">
        Simulation · constant-product model · results/E6.json
      </p>
      <p>
        All {E6.cases} cases hit the kill line in development and held-out data.
        Held-out mean price error rose {pct(E6.heldoutRange[0] - 1)} to{" "}
        {pct(E6.heldoutRange[1] - 1)} against the static-fee pool. The
        registered limit was 10%.
      </p>
      <h3>E1: where toxic markout sits, and the trigger it chose</h3>
      <p className="tl">
        Historical backtest · {E1.window} · {E1.swaps.toLocaleString("en-US")}{" "}
        swaps
      </p>
      <ul>
        {E1.findings.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <p>
        Selected trigger: N₀ = ${E1.selected.n0.toLocaleString("en-US")}, N_min
        = ${E1.selected.nMin.toLocaleString("en-US")}, h = {E1.selected.h} s, τ
        = {E1.selected.tauBps} bp; development recall {pct(E1.devRecall)} at a
        flagged share of {E1.devPhiCount.toFixed(3)}.
      </p>
      <h3>All twelve experiments</h3>
      <div className="tablewrap">
        <Table className="table">
          <TableHeader>
            <TableRow>
              <TableHead>Experiment</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Pass or kill line</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {EXPERIMENTS.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <b className="mono">{e.id}</b> {e.name}
                  <br />
                  <span className="dim">{e.question}</span>
                </TableCell>
                <TableCell>{e.kind}</TableCell>
                <TableCell>{e.line}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`chip ${STATUS_CHIP[e.status]}`}
                  >
                    {e.status}
                  </Badge>
                  {e.note && <p className="dim">{e.note}</p>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <h3>Full write-up</h3>
      <Doc load={singles.results![1]} />
    </div>
  );
}

function Engineering() {
  return (
    <div className="md">
      <h2>Engineering measurements</h2>
      <div className="tablewrap">
        <Table className="table">
          <TableHeader>
            <TableRow>
              <TableHead>What</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ENGINEERING.map((f) => (
              <TableRow key={f.label}>
                <TableCell>{f.label}</TableCell>
                <TableCell className="mono">{f.value}</TableCell>
                <TableCell>{f.kind}</TableCell>
                <TableCell className="dim">{f.source}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <h3>Gas history</h3>
      <Doc load={singles.gas![1]} />
    </div>
  );
}

function Spec() {
  return (
    <div className="md">
      <h2>The specification</h2>
      <p>
        The full developer specification (about 2,900 lines: mechanism,
        formulas, parameters, research plan, threat model and build plan) lives
        in the repository as <code>docs/SPEC.md</code>. It is private for now
        and deliberately not bundled into this page, because a hosted build
        publishes everything it contains.
      </p>
      <p>
        The lessons and decisions in this reader explain each part of it as
        built, and each decision records where the build departs from it and
        why.
      </p>
    </div>
  );
}

export function DocsView({ rest }: { rest: string }) {
  const [section, id] = rest.split("/");
  let body;
  let current = section || "overview";
  if (
    section === "lessons" &&
    id &&
    lessons[LESSONS.find((l) => l.slug === id)?.path ?? ""]
  ) {
    body = <Doc load={lessons[LESSONS.find((l) => l.slug === id)!.path]!} />;
  } else if (
    section === "decisions" &&
    id &&
    DECISIONS.some((d) => d.slug === id)
  ) {
    body = (
      <Doc load={decisions[DECISIONS.find((d) => d.slug === id)!.path]!} />
    );
  } else if (section === "research") body = <Research />;
  else if (section === "engineering") body = <Engineering />;
  else if (section === "spec") body = <Spec />;
  else if (section === "deployment")
    body = (
      <>
        <Contracts />
        <Doc load={singles.deployments![1]} />
      </>
    );
  else if (section && singles[section])
    body = <Doc load={singles[section]![1]} />;
  else {
    current = "overview";
    body = <Overview />;
  }
  const link = (r: string, label: string) => (
    <a
      href={href("docs", r)}
      className={
        current === r.split("/")[0] && (r.split("/")[1] ?? "") === (id ?? "")
          ? "on"
          : ""
      }
      aria-current={current === r ? "page" : undefined}
    >
      {label}
    </a>
  );

  return (
    <section className="view" aria-labelledby="docs-title">
      <div className="wrap view-head">
        <h1 id="docs-title" className="h2">
          Everything behind <em>the mechanism.</em>
        </h1>
      </div>
      <div className="wrap docs">
        <nav className="docs-nav" aria-label="Documents">
          <p className="tl">Start</p>
          {link("overview", "Overview")}
          {link("research", "Research and evidence")}
          {link("engineering", "Engineering measurements")}
          {link("spec", "The specification")}
          <p className="tl">How it works</p>
          {LESSONS.map((l) => (
            <a
              key={l.slug}
              href={href("docs", `lessons/${l.slug}`)}
              className={section === "lessons" && id === l.slug ? "on" : ""}
            >
              {l.slug.slice(0, 2)} · {title(l.slug)}
            </a>
          ))}
          <p className="tl">Operations</p>
          {link("runbook", "Runbook")}
          {link("threats", "Threat model")}
          {link("deployment", "Deployment")}
          <Accordion
            defaultValue={section === "decisions" ? ["decisions"] : []}
          >
            <AccordionItem value="decisions">
              <AccordionTrigger>
                Decisions ({DECISIONS.length})
              </AccordionTrigger>
              <AccordionContent>
                {DECISIONS.map((d) => (
                  <a
                    key={d.slug}
                    href={href("docs", `decisions/${d.slug}`)}
                    className={
                      section === "decisions" && id === d.slug ? "on" : ""
                    }
                  >
                    {d.slug.slice(0, 4)} · {title(d.slug)}
                  </a>
                ))}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </nav>
        <article className="docs-body">{body}</article>
      </div>
    </section>
  );
}
