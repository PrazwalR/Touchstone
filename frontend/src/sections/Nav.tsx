import { Menu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deployment } from "../chain/deployment.ts";
import { href, VIEWS, type View } from "../router.ts";

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path
        fill="#1E1E22"
        stroke="rgba(243,239,231,.35)"
        strokeWidth="1.5"
        d="M91 20 L80 9 L20 9 L9 20 L9 34.593 L91 25.342ZM80 91 L91 80 L91 33.88 L55.5 41.01 L55.5 91ZM9 80 L20 91 L44.5 91 L44.5 43.219 L9 50.348Z"
      />
      <path fill="#E8B44A" d="M91 25.342 L9 34.593 L9 50.348 L91 33.88Z" />
    </svg>
  );
}

export function Nav({ view }: { view: View }) {
  return (
    <header className="nav">
      <nav className="nav-in" aria-label="Main navigation">
        <a
          className="brand"
          href={href("overview")}
          aria-label="Touchstone overview"
        >
          <Mark />
          <span>touchstone</span>
        </a>
        <ul className="nav-links">
          {VIEWS.map(([v, label]) => (
            <li key={v}>
              <a
                href={href(v)}
                aria-current={view === v ? "page" : undefined}
                className={view === v ? "on" : ""}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
        <Badge
          variant="outline"
          className="chip chip-illu net-badge"
          title="All transactions use this testnet"
        >
          {deployment.name}
        </Badge>
        <div className="mobile-nav">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Open navigation"
                />
              }
            >
              <Menu />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {VIEWS.map(([v, label]) => (
                <DropdownMenuItem
                  key={v}
                  render={
                    <a
                      href={href(v)}
                      aria-current={view === v ? "page" : undefined}
                    />
                  }
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
    </header>
  );
}
