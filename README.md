# Pi Session Inspector

Deterministic, local-only session analytics for [Pi](https://github.com/earendil-works/pi). Reconstructs Pi-native session data with confidence-aware live/cooperative metadata. No LLM analytics. No cloud. No daemon.

> **Status: current, history, global, ledger, HTML, and JSON reports are available.**

## Planned install

```bash
pi install npm:pi-session-inspector
/session-inspector
```

Commands and aliases:

```text
/session-inspector [current|history|global|ledger] [--scope active|tree] [--format tui|html|json] [--output PATH] [--no-open] [--subagents-artifact PATH]
/session-ins ...
```

Current and ledger default to active scope/TUI; `/ledger` opens directly on the lazy Ledger tab. History and global output reports use only durable full-tree scope (history/global TUI selection remains unavailable). `--output` creates a user-owned export that cache cleanup never removes, including when placed in the cache directory. HTML opens with the platform opener unless `--no-open`; JSON and HTML share the same report DTO as TUI.

`--subagents-artifact PATH` reads one bounded, local public pi-subagents JSON artifact for current HTML, JSON, or TUI reports. The path and raw artifact are never persisted or rendered; missing or unreadable artifacts show unavailable evidence.

## Guarantees

- Pi session files remain source of truth; Inspector writes only its own metadata/WAL and a namespaced tracking marker.
- Telemetry cannot block/change agent execution.
- WAL excludes prompts, outputs, raw tool arguments/results and provider payloads.
- Metrics label native, live, cooperative, inferred, unavailable, or unsupported evidence.

Reports may still reveal project metadata. Treat exports as sensitive.

## Canonical design documentation

- [Pi ecosystem research](docs/research/pi-ecosystem.md)
- [v1 specification](docs/specs/pi-session-inspector-v1.md)
- [implementation plan](docs/plans/pi-session-inspector-v1-implementation.md)
- [architecture decisions](docs/architecture/README.md)

These documents and ADRs are canonical. Planning scratch files are not retained as competing authority.

See [contributing](CONTRIBUTING.md), [security](SECURITY.md), and [agent guidance](AGENTS.md).

## License

[MIT](LICENSE) © twKrash.
