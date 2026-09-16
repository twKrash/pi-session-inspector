# README images

The root `README.md` embeds two screenshots as **GitHub release assets**, not as
repository files. No PNG is tracked here, so the repository and the npm tarball
carry no binary image bytes.

| File | Subject | Size |
| --- | --- | --- |
| `overview-current-dark.png` | Overview tab of a current session, dark theme | 2541×1269, ~100 kB |
| `overview-global-light.png` | Overview tab of the global report, light theme | 2540×1268, ~95 kB |

Both are attached to the [`v0.13.3` release](https://github.com/twKrash/pi-session-inspector/releases/tag/v0.13.3)
and referenced by absolute URL:

```text
https://github.com/twKrash/pi-session-inspector/releases/download/v0.13.3/overview-current-dark.png
https://github.com/twKrash/pi-session-inspector/releases/download/v0.13.3/overview-global-light.png
```

`docs/images/*.png` is ignored by `.gitignore` so a local capture can never be
committed by accident. Only this file is tracked in this directory.

## Provenance

Both images were captured from a real local Pi installation against the
`0.13.3` tree, not from a fixture session. The current-session shot therefore
shows a real session id, real cost and token figures, and real dates. That is a
deliberate decision by the repository owner; do not treat these two files as an
example of a sanitized capture.

## Replacing or updating an image

Uploading over the same asset name keeps the README URL unchanged, so no
markdown edit is needed:

```sh
gh release upload v0.13.3 path/to/overview-current-dark.png --clobber
```

Prefix that command with `env -u GH_TOKEN -u GITHUB_TOKEN` if you want to
confirm the asset is readable without authentication; a public release asset
answers an anonymous `GET`.

```sh
env -u GH_TOKEN -u GITHUB_TOKEN curl -sIL -o /dev/null -w '%{http_code}\n' \
  https://github.com/twKrash/pi-session-inspector/releases/download/v0.13.3/overview-current-dark.png
```

For a new asset (a different view, a new theme, or a new release), capture from
a **sanitized fixture session** — never a real one. The Overview tab shows
session usage, cost, model names, tool counts, and project-derived labels, so an
unsanitized capture leaks all of them.

- No real session ids, project or file paths, cost or token figures that map to
  a real session, provider/model identifiers you would not publish, prompts,
  outputs, tool arguments, or results.
- Run a synthetic session for the data, or redact until nothing
  project-specific remains.
- Keep the file name, the theme, and roughly the current width so the README
  table stays balanced.
