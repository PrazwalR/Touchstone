import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { deployment, explorerAddress } from "../chain/deployment.ts";

export function Status() {
  return (
    <section id="status" className="act" aria-labelledby="status-title">
      <div className="wrap act-head">
        <h2 id="status-title" className="h2">
          Built to be verified.
        </h2>
      </div>
      <div className="wrap">
        <div className="ledger3">
          <Card className="col3">
            <h3 className="h3">Running on testnet.</h3>
            <ul>
              <li>
                <b>Settlement, end to end</b>Deposits, signed-price settlement,
                refunds, rebates and LP vesting.
              </li>
              <li>
                <b>254 Forge tests · 37 suites</b>Plus 3 fork tests. Measured 7
                November 2026.
              </li>
              <li>
                <b>Seven verified contracts</b>
                {deployment.name}, with an ETH/USDC pool, the licence auction
                and the quote lens. Deployed 7 November 2026.{" "}
                <a
                  href={explorerAddress(deployment.contracts.hook)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View the hook ↗
                </a>
              </li>
            </ul>
          </Card>
          <Card className="col3">
            <h3 className="h3">The next deployment.</h3>
            <ul>
              <li>
                <b>Licence in a live pool</b>The auction is deployed and the
                demo pool carries lease terms. Its economics are not yet
                validated.
              </li>
              <li>
                <b>Licence economics</b>Further simulation is required before
                enabling the licence in a pool.
              </li>
              <li>
                <b>Research validation</b>Remaining experiments need fresh
                inputs and comparison margins.
              </li>
            </ul>
          </Card>
          <Card className="col3">
            <h3 className="h3">Testnet, with limits.</h3>
            <ul>
              <li>
                <b>No external audit</b>Internal reviews are recorded; no
                independent firm has audited the code.
              </li>
              <li>
                <b>No mainnet deployment</b>Live settlement evidence has not
                been collected in this checkout.
              </li>
              <li>
                <b>Interface routing</b>A deployed hook does not imply routing
                through a Uniswap interface.
              </li>
            </ul>
          </Card>
        </div>
        <Accordion className="mt-8">
          <AccordionItem value="checks">
            <AccordionTrigger>Reproduce the checks</AccordionTrigger>
            <AccordionContent>
              <figure className="code">
                <pre>
                  <code>{`cd contracts\nforge build --sizes\nforge test\ncd ../frontend && pnpm install && pnpm test\npython3 -I research/reference/check_report_numbers.py research/reference/vectors`}</code>
                </pre>
              </figure>
              <p className="body mt-4">
                The laboratory is checked against the research reference. Code
                excerpts are checked against contract source. The repository is
                private; verified contract source is available on Arbiscan.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </section>
  );
}
