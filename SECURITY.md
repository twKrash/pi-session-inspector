# Security policy

## Supported versions

Only latest released Pi Session Inspector version is planned to receive fixes. v1 targets latest stable Pi at release time.

## Report a vulnerability

Until public disclosure contact is configured, do **not** open a public issue containing exploit details, exports, session data, logs, prompts, outputs, or credentials. Contact repository owner privately through GitHub profile/security contact. Acknowledgement and remediation timeline will be published before first release.

## Data boundary

Inspector is local-only and intends not to copy prompt/output/tool payload content. Same-user processes may still read local Pi sessions or user-selected exports. Generated reports can contain sensitive metadata; do not share them without review.

Security-sensitive changes require regression tests for redaction, bounded telemetry, path/command export, atomic storage, and failure isolation.
