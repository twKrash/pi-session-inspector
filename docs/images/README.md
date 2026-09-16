# README images

The root `README.md` embeds two screenshots as **GitHub release assets**. One
extra copy is tracked in this directory for the package gallery, because the two
hosts differ in how they serve bytes:

| URL | `Content-Type` | Notes |
| --- | --- | --- |
| `github.com/…/releases/download/v0.13.3/…png` | `application/octet-stream`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` | fine for `<img>` in a browser, which still sniffs; a strict consumer may refuse it |
| `raw.githubusercontent.com/…/main/docs/images/…png` | `image/png` | what `pi.image` uses, so the [Pi package gallery](https://pi.dev/packages) can render the preview |

| File | Subject | Where it lives |
| --- | --- | --- |
| `overview-current-dark.png` | Overview tab of a current session, dark theme | release asset **and** tracked here (gallery preview) |
| `overview-global-light.png` | Overview tab of the global report, light theme | release asset only |

README URLs:

```text
https://github.com/twKrash/pi-session-inspector/releases/download/v0.13.3/overview-current-dark.png
https://github.com/twKrash/pi-session-inspector/releases/download/v0.13.3/overview-global-light.png
```

Gallery URL (`pi.image` in `package.json`):

```text
https://raw.githubusercontent.com/twKrash/pi-session-inspector/main/docs/images/overview-current-dark.png
```

`docs/images/*.png` is ignored by `.gitignore` so a local capture can never be
committed by accident; `overview-current-dark.png` is un-ignored deliberately.
Neither copy ships in the npm tarball, whose `files` allowlist covers `src` and
the root documents only.

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

Update the tracked gallery copy as well, or the two URLs drift apart:

```sh
cp path/to/overview-current-dark.png docs/images/overview-current-dark.png
```

Both hosts answer an anonymous `GET`, so the check below needs no credentials:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN curl -sIL -o /dev/null -w '%{http_code} %{content_type}\n' \
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
