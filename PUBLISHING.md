# Publishing LeakLens

Maintainer checklist for cutting a release to the VS Code Marketplace. This file is **not**
shipped in the `.vsix` (excluded by `.vscodeignore`).

## 1. Pre-flight (must be green)

```sh
npm test            # 523 tests, engine 100% coverage
npm run build       # typecheck + esbuild bundles + Tailwind CSS
```

- [ ] `version` in `package.json` bumped (currently **5.0.0**)
- [ ] `CHANGELOG.md` has an entry for this version
- [ ] `README.md` presentation reads correctly (it is the Marketplace detail page)
- [ ] `media/icon.png` is the intended icon (256×256; source is `media/icon-store.svg`)

## 2. Package

```sh
npm run package     # -> leaklens-5.0.0.vsix  (build + vsce package --no-dependencies)
```

Confirm the file list shows only `dist/**`, `media/icon.png`, `media/icon.svg`,
`README.md`, `CHANGELOG.md`, `LICENSE`, `package.json` — no sources/tests/brand-source SVG.

## 3. Smoke-test the artifact locally

```sh
code --install-extension leaklens-5.0.0.vsix
```

Reload, open a file with a fake key, confirm the squiggle/hover/panel work and the new icon
shows in the Activity Bar and Extensions list.

## 4. Publish to the Marketplace

Requires a **publisher** (`leaklens`) and an Azure DevOps **Personal Access Token** with the
*Marketplace → Manage* scope. See https://code.visualstudio.com/api/working-with-extensions/publishing-extension

```sh
# one-time: authenticate
npx vsce login leaklens          # paste the PAT when prompted

# publish the already-built artifact
npx vsce publish --packagePath leaklens-5.0.0.vsix
# (or `npx vsce publish` to build+publish, or `-p <PAT>` to pass the token inline)
```

Optionally also publish to **Open VSX** (for Cursor/VSCodium users):

```sh
npx ovsx publish leaklens-5.0.0.vsix -p <open-vsx-token>
```

## 5. Tag the release

```sh
git add -A
git commit -m "[Leak Lens] Release 5.0.0 — milestone + refreshed store presentation"
git tag v5.0.0
git push && git push --tags
```
