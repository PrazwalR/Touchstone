# Documentation

## Understand the system

| Guide | Purpose |
| --- | --- |
| [Formulas and research basis](formulas-research-and-current-code.md) | Variables, derivations, implementation arithmetic and evidence boundaries |
| [Threat model](threat-model.md) | Trust assumptions, attack surfaces and remaining risks |
| [Implementation lessons](lessons/) | Component walkthroughs and integration details |
| [Design decisions](decisions/) | Rationale and constraints behind the implementation |

## Build and operate

| Guide | Purpose |
| --- | --- |
| [Project setup](../README.md) | Requirements, build commands and validation |
| [Runbook](runbook.md) | Deployments, services, alerts and incident response |
| [Deployment manifest](../DEPLOYMENTS.md) | Published addresses and transaction references |
| [Frontend](../frontend/README.md) | Interface configuration and wallet behavior |
| [Keeper](../backend/README.md) | Settlement service configuration and recovery |
| [Indexer](../backend/indexer/README.md) | Indexed records and read-only API |
| [Bots](../backend/bots/README.md) | Testnet demonstration tooling |

## Evaluate the evidence

| Reference | Purpose |
| --- | --- |
| [Research setup](../research/README.md) | Inputs and reproduction commands |
| [Research results](../research/results/README.md) | Recorded outcomes, failed gates and limitations |
| [Registered experiments](../research/prereg/) | Experiment definitions and frozen analysis records |
| [Gas measurements](gas.md) | Measured costs and release targets |
| [Audit records](audits/) | Findings, regression evidence and release-check baselines |

Historical backtests, model simulations, local tests and testnet transactions answer different questions. Software test passes do not establish economic profitability. E3/E4 have no published verdict here, and the registered E6 freshness experiment failed.

## Detailed specifications

[The project specification](../spec.md) and [developer specification](developer-spec-2026-10-25.md) retain the detailed design. For current executable behavior, consult the source and the [formula implementation notes](formulas-research-and-current-code.md). Specification text can describe planned or experimentally gated functionality.
