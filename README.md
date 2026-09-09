# Pi Session Inspector

Deterministic, local-only session analytics for [Pi](https://github.com/earendil-works/pi). Reconstructs Pi-native session data with confidence-aware live/cooperative metadata. No LLM analytics. No cloud. No daemon.

> **Status: current-session TUI and local integration evidence are available; history, global, and export views remain planned.**

## Planned install

```bash
pi install npm:pi-session-inspector
/session-inspector
```

Aliases and planned modes:

```text
/session-inspector [current] [--subagents-artifact PATH]
/session-ins ...

`--subagents-artifact PATH` reads one bounded, local public pi-subagents JSON artifact for the current view only. The path and raw artifact are never persisted or rendered; missing or unreadable artifacts show unavailable evidence.
```

Current defaults to active branch/TUI. History/global resource views default to full tree. JSON, HTML and TUI render same report data.

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
