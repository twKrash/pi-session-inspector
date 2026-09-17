# README images

The root `README.md` embeds two screenshots as **GitHub release assets**, on the
release whose tree they depict. One of them is also tracked in this directory as
the package-gallery preview, because the two hosts differ in how they serve
bytes:

| URL | `Content-Type` | Notes |
| --- | --- | --- |
| `github.com/…/releases/download/v1.2.0/…png` | `application/octet-stream`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` | fine for `<img>` in a browser, which still sniffs; a strict consumer may refuse it |
| `raw.githubusercontent.com/…/main/docs/images/…png` | `image/png` | what `pi.image` uses, so the [Pi package gallery](https://pi.dev/packages) can render the preview |

| File | Subject | Where it lives |
| --- | --- | --- |
| `overview-global-dark.png` | Overview tab of the global report, dark theme | release asset on `v1.2.0` **and** tracked here (gallery preview); the README hero |
| `overview-global-light.png` | Overview tab of the global report, light theme | release asset on `v1.2.0` only |
| `overview-current-dark.png` | Overview tab of a current session, dark theme | release asset on `v0.13.3` only; historical, no longer embedded in the README |

README URLs:

```text
https://github.com/twKrash/pi-session-inspector/releases/download/v1.2.0/overview-global-dark.png
https://github.com/twKrash/pi-session-inspector/releases/download/v1.2.0/overview-global-light.png
```

Gallery URL (`pi.image` in `package.json`):

```text
https://raw.githubusercontent.com/twKrash/pi-session-inspector/main/docs/images/overview-global-dark.png
```

`docs/images/*.png` is ignored by `.gitignore` so a local capture can never be
committed by accident; `overview-global-dark.png` is un-ignored deliberately.
The tracked preview does not ship in the npm tarball, whose `files` allowlist
covers `src` and the root documents only.

## Provenance

Every asset is a capture from a real local Pi installation, not from a fixture
session, and that is a deliberate decision by the repository owner: the
current-session shot shows a real session id, and the global pair shows real
cost and token figures and real dates. Do not treat any of these files as an
example of a sanitized capture.

- `overview-current-dark.png` — captured against the `0.13.3` tree; kept on the
  `v0.13.3` release for the record.
- `overview-global-dark.png`, `overview-global-light.png` — captured against the
  `1.2.x` tree, so they show the metric-selecting daily chart, and hosted on the
  `v1.2.0` release.

The pair lives on the release it was captured against; a refreshed capture is
uploaded to the newest release and the README URLs are repointed in the same
change, rather than moving unchanged assets from tag to tag.

## Replacing or updating an image

Uploading over the same asset name keeps the README URL unchanged, so no
markdown edit is needed:

```sh
gh release upload v1.2.0 path/to/overview-global-light.png --clobber
```

An asset is named after the file's basename: `gh`'s `file#text` suffix sets a
display label, not a rename, so copy the capture to the target name first.

Downloads are served through a CDN, so a freshly clobbered asset can still
return the previous bytes for a short while. Compare the stored digest instead
of a single anonymous `GET`:

```sh
gh api repos/twKrash/pi-session-inspector/releases/tags/v1.2.0 \
  -q '.assets[] | "\(.name) \(.digest)"'
```

Both hosts answer an anonymous `GET`, so the check below needs no credentials:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN curl -sIL -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://github.com/twKrash/pi-session-inspector/releases/download/v1.2.0/overview-global-dark.png
```

When the gallery-preview asset changes, update the tracked copy too, or the two
copies of that file drift apart:

```sh
cp path/to/overview-global-dark.png docs/images/overview-global-dark.png
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
