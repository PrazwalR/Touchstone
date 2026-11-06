import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { NODES } from "../content/acts.ts";

const isComment = (s: string) => /^\s*(\/\/|\/\*|\*|…)/.test(s);

export function Pipeline() {
  const [i, setI] = useState(0);
  const node = NODES[i];
  return (
    <section id="pipeline" className="act" aria-labelledby="pipe-title">
      <div className="wrap act-head">
        <div className="stack">
          <h2 id="pipe-title" className="h2">
            How the system <em>settles.</em>
          </h2>
        </div>
      </div>
      <div className="wrap">
        <Tabs value={i} onValueChange={(v) => setI(Number(v))}>
          <TabsList className="pipe" aria-label="Settlement pipeline">
            {NODES.map((n, k) => (
              <TabsTrigger value={k} key={n.name} className="node">
                <span className="dot">0{k + 1}</span>
                <span className="lb">{n.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={i} className="pdetail">
            <div className="stack">
              <h3 className="h3">{node.title}</h3>
              <p className="body">{node.role}</p>
              <div className="chips">
                <Badge variant="outline" className="chip chip-none">
                  {node.where}
                </Badge>
                <Badge variant="outline" className={`chip ${node.statusCls}`}>
                  {node.status}
                </Badge>
              </div>
            </div>
            <figure className="code">
              <figcaption className="code-h">
                <span>{node.excerpt.label}</span>
                <span>excerpt</span>
              </figcaption>
              <pre>
                <code>
                  {node.excerpt.lines.map((ln, k) => (
                    <span key={k} className={`ln ${isComment(ln) ? "c" : ""}`}>
                      {ln}
                    </span>
                  ))}
                </code>
              </pre>
            </figure>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
