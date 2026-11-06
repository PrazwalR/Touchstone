import { deployments } from "../../deployments/index.ts";

export function selectDeployment(chain?: string) {
  const name = chain || "arbitrum-sepolia";
  if (!Object.hasOwn(deployments, name)) {
    throw new Error(`No synced deployment for VITE_CHAIN=${name}. Available: ${Object.keys(deployments).join(", ")}`);
  }
  return deployments[name as keyof typeof deployments];
}
