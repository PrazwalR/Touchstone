import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deployment } from "../chain/deployment.ts";
import { shortAddr } from "../format.ts";
import { useWallet } from "../wallet/WalletContext.tsx";

export function WalletButton() {
  const w = useWallet();
  return (
    <div className="wallet">
      {w.account && !w.onRightChain && (
        <Button variant="outline" onClick={() => void w.switchToDeployment()}>
          Switch network
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant={w.account ? "outline" : "secondary"}
              disabled={w.connecting}
              title={w.account ?? undefined}
            />
          }
        >
          {w.account
            ? shortAddr(w.account)
            : w.connecting
              ? "Connecting…"
              : "Connect wallet"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {w.account ? (
            <>
              <DropdownMenuItem
                render={
                  <a
                    href={`${deployment.explorer}/address/${w.account}`}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                View account
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => w.disconnect()}>
                Disconnect
              </DropdownMenuItem>
            </>
          ) : w.wallets.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              Install MetaMask, Rabby or another browser wallet, then reload.
            </p>
          ) : (
            w.wallets.map((x) => (
              <DropdownMenuItem
                key={x.info.uuid}
                onClick={() => void w.connect(x)}
              >
                {x.info.icon && (
                  <img src={x.info.icon} alt="" width={22} height={22} />
                )}
                {x.info.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {w.error && (
        <p className="err wallet-err" role="alert">
          {w.error}
        </p>
      )}
    </div>
  );
}
