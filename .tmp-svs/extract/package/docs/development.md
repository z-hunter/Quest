# Development and releases

[← Host integration](./integration.md) · [README](../README.md)

## Local setup

```sh
npm ci
npm test
npm run build
npm run lint
```

`npm run build` emits distributable JavaScript and declarations to `dist/`. The package commits `dist/` because Git-tag consumers may install with lifecycle scripts disabled.

## Testing boundary

Package tests cover profile migration and validation, virtual-pixel overlays, controlled React sections, and terminal adapter disposal. A host must test its own source canvas, RAF, resize, persistence, storage, and native terminal lifecycle separately.

## Releases

1. Update documentation, tests, and the package version.
2. Run the three validation commands above and inspect `npm pack --dry-run`.
3. Commit the generated `dist/` files with the source change.
4. Create and push an immutable SemVer tag.
5. Update consuming applications to that tag and run their integration checks.

Never move an existing tag. If a release has a packaging or runtime defect, publish a patch release.

## Licensing and commercial use

New work in this repository is distributed under PolyForm Noncommercial 1.0.0. Commercial users require a separate written license. Maintainers must verify that accepted contributions carry the rights described in [CONTRIBUTING.md](../CONTRIBUTING.md) before including them in a release.
