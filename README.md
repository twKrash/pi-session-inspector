# Pi Session Inspector

Deterministic, local-only session analytics for [Pi](https://github.com/earendil-works/pi). Reconstructs Pi-native session data with confidence-aware live/cooperative metadata. No LLM analytics. No cloud. No daemon.

> **Status: design baseline. No production implementation yet.**

## Planned install

```bash
pi install npm:pi-session-inspector
/session-inspector
```

Aliases and planned modes:

```text
/session-inspector [current|history|global|ledger] [--scope active|tree] [--format tui|html|json]
/session-ins ...
```

Current defaults to active branch/TUI. History/global resource views default to full tree. JSON, HTML and TUI render same report data.

## Guarantees

- Pi session files remain source of truth; Inspector writes only its own metadata/WAL and a namespaced tracking marker.
- Telemetry cannot block/change agent execution.
- WAL excludes prompts, outputs, raw tool arguments/results and provider payloads.
- Metrics label native, live, cooperative, inferred, unavailable, or unsupported evidence.

Reports may still reveal project metadata. Treat exports as sensitive.

## Documentation

- [v1 specification](docs/specs/pi-session-inspector-v1.md)
- [implementation plan](docs/plans/pi-session-inspector-v1-implementation.md)
- [Pi ecosystem research](docs/research/pi-ecosystem.md)
- [architecture decisions](docs/architecture/README.md)
- [contributing](CONTRIBUTING.md), [security](SECURITY.md), [agent guidance](AGENTS.md)

## License

Planned: MIT © twKrash. `LICENSE` arrives with package implementation.
