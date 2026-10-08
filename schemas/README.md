# Vendored JSON schemas

The `github-actions` check validates against these schemas offline. They are copied verbatim from [SchemaStore](https://github.com/SchemaStore/schemastore) and are not modified.

| File                   | Source                                            |
| ---------------------- | ------------------------------------------------- |
| `github-workflow.json` | https://json.schemastore.org/github-workflow.json |
| `github-action.json`   | https://json.schemastore.org/github-action.json   |

## Licence

SchemaStore is licensed under the [Apache License 2.0](./LICENSE) (copied from https://github.com/SchemaStore/schemastore/blob/master/LICENSE). The rest of `@makerx/verify` is MIT.

## Refreshing

```sh
npm run schemas:refresh
```

This re-downloads both schemas and the licence. Review the diff, then run `npm run verify` and the tests.
