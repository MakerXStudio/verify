# Changelog

## [1.3.0](https://github.com/MakerXStudio/verify/compare/v1.2.0...v1.3.0) (2026-10-08)


### Features

* add native github-actions check ([3dde77f](https://github.com/MakerXStudio/verify/commit/3dde77ffa380f351f9e1694146d4d06c5a907a0d))
* native github-actions check ([701ba01](https://github.com/MakerXStudio/verify/commit/701ba01dadde73281ef10a161e1fd1a359d99c7c))
* reduce unused-code and duplicate-code false positives ([#18](https://github.com/MakerXStudio/verify/issues/18)) ([5d01501](https://github.com/MakerXStudio/verify/commit/5d01501a26add32e4a2f50854db56cd71f128600))
* support max-warnings for unused code and duplicate code ([e089c85](https://github.com/MakerXStudio/verify/commit/e089c85ac841510b8f6322de92849863dea06e74))


### Bug Fixes

* check negations against included ([c13ac90](https://github.com/MakerXStudio/verify/commit/c13ac90ff2e43b63f2aff550a9d35e7223b0d33e))
* **check-types:** guard tsc -b against emitting into source tree ([e9eff65](https://github.com/MakerXStudio/verify/commit/e9eff657cccc52e59ec80460b9918aeb5740c135))
* **check-types:** guard tsc -b against emitting into source tree ([f111034](https://github.com/MakerXStudio/verify/commit/f111034c15ed52d02efc3eb58bc70aab6c57c09c))
* **check-types:** use tsc -b when tsconfig has references ([3ca7168](https://github.com/MakerXStudio/verify/commit/3ca71681a9b97327ca3601fea5fa9885f1f0b274))
* **check-types:** use tsc -b when tsconfig has references ([b8b3a1e](https://github.com/MakerXStudio/verify/commit/b8b3a1edfbf244ad806693ead3f2948892daa6cc))
* cross-platform external check commands ([#17](https://github.com/MakerXStudio/verify/issues/17)) ([f432b9c](https://github.com/MakerXStudio/verify/commit/f432b9ca6f1603d38e9af9fc4c514bff71ea162d))
* **init:** skip installed deps, isolate install failures, pre-select prompt defaults ([7c5f7da](https://github.com/MakerXStudio/verify/commit/7c5f7da6c039ef98617b70160d7b93c6672fac7e))
* **init:** skip installed deps, isolate install failures, pre-select prompt defaults ([cb5849a](https://github.com/MakerXStudio/verify/commit/cb5849a64ee9d3c749992303a995050e1def3009))
* let **/ match zero directories ([248cbb0](https://github.com/MakerXStudio/verify/commit/248cbb092126b7316e90bbe83aa3eb75cf0c3f1c))

## [1.2.0](https://github.com/MakerXStudio/verify/compare/v1.1.0...v1.2.0) (2026-07-09)


### Features

* highlight failing checks and de-noise duplicate-code output ([a62048c](https://github.com/MakerXStudio/verify/commit/a62048c5a81ff15854d61a9a2c74fea55270330a))


### Bug Fixes

* exclude release-please CHANGELOG.md from oxfmt ([c2ad063](https://github.com/MakerXStudio/verify/commit/c2ad063d720d9198175a75c1c6c5281bf1fd5567))
* unbreak release format check + clearer verify --verbose output ([afabedf](https://github.com/MakerXStudio/verify/commit/afabedf08c26d07c4c41f05a265c31d0f7737a99))

## [1.1.0](https://github.com/MakerXStudio/verify/compare/v1.0.0...v1.1.0) (2026-07-09)


### Features

* add opt-in comment-block check with AI pushback ([94cf2d8](https://github.com/MakerXStudio/verify/commit/94cf2d87d73a7d647f9e35ef3f9266d28f37306d))
* add opt-in comment-block check with AI pushback ([842b4e7](https://github.com/MakerXStudio/verify/commit/842b4e7f095a8e0674ea8870a5595134bf67c546))
* configurable external checks via -- passthrough and verifyx eject ([2bdbd1c](https://github.com/MakerXStudio/verify/commit/2bdbd1cfbffbd694d8624da7ebbf5b9e5a26b09f))
* configurable external checks via -- passthrough and verifyx eject ([8411fd0](https://github.com/MakerXStudio/verify/commit/8411fd01cc289f879ef7a6fb07395e6ec016faad))
* init offers "run everything with defaults" as an up-front choice ([e52b697](https://github.com/MakerXStudio/verify/commit/e52b6977c3cc14ef107ee2e7549ef64aeabf648c))
* init teaches knip to ignore the tools verifyx runs (no consumer setup) ([5618ad9](https://github.com/MakerXStudio/verify/commit/5618ad927ea6377d3185ce57b51b1344da249997))
* merge comment-block + block-comments into one `comments` check ([7dae650](https://github.com/MakerXStudio/verify/commit/7dae650773ddcf98aa8ad076bc78723222a5ecc2))
* name the tool + command + docs when an external check fails ([512c8ea](https://github.com/MakerXStudio/verify/commit/512c8eabd4d903766f48c321d0d36c718b05f96f))
* orchestrate multiple checks with a convention-based verify CLI ([6075410](https://github.com/MakerXStudio/verify/commit/607541095dcbcc915f323a3c469f0a70774d2328))
* run only defined verify:* scripts by default; add `verifyx all` ([8d16593](https://github.com/MakerXStudio/verify/commit/8d1659360c559963acecaa760eb273fc354d567c))
* run verifyx all in parallel; --measure prints only its table ([87ae112](https://github.com/MakerXStudio/verify/commit/87ae112d08a81f7829db94a341a82b8661ac75f5))
* ship a verify skill + CLAUDE.md/AGENTS.md pointer instead of a slash command ([cfdeccd](https://github.com/MakerXStudio/verify/commit/cfdeccd9ba73b2a8643def6d54c2775d128f3260))
* silent on success — gate orchestrator chatter behind --verbose/--measure ([89b2c3b](https://github.com/MakerXStudio/verify/commit/89b2c3b2793a96e9f9e959fd5c48632be6c02d96))
* support verify:&lt;name&gt;:fix override variants ([c958bcd](https://github.com/MakerXStudio/verify/commit/c958bcd89d1bc211ad8d183360baa55bd486023c))
* transform complexity-verifier into @makerx/verify (multi-check verifier) ([5d1385d](https://github.com/MakerXStudio/verify/commit/5d1385df5be03c8d274168f3b25339394f2e80fc))
* verifyx all is silent on success and runs custom verify:* scripts ([413bdbb](https://github.com/MakerXStudio/verify/commit/413bdbb636004a27de716885b405291428cb3728))
* verifyx runs tests by convention, with --no-tests to opt out ([a2b5d3a](https://github.com/MakerXStudio/verify/commit/a2b5d3a9b090870ebc6b13e4e16cf3ac6393cda1))


### Bug Fixes

* address PR review — CI diff base for new-comments + config ignores ([1341a57](https://github.com/MakerXStudio/verify/commit/1341a570ab7a969257574f53c843ea80a75cae3c))
* auto-fix locally and check-only in CI; call built-ins from verify:* scripts ([327f2ee](https://github.com/MakerXStudio/verify/commit/327f2ee1dabdce26ed5dffcacb34a8f19e4c7781))
* rename CLI binary to verifyx and deny the native watcher install script ([28ca3ee](https://github.com/MakerXStudio/verify/commit/28ca3ee46caab20a554fdb6ff725ec1a3d1e1278))
* verifyx all now honours run flags passed after the subcommand ([4545177](https://github.com/MakerXStudio/verify/commit/4545177dc8748dcac318f622f250b813d6520c45))

## 1.0.0 (2026-07-08)

### Features

- initial complexity-verifier CLI ([eeccd7c](https://github.com/MakerXStudio/complexity-verifier/commit/eeccd7c2238f07b02511574b5d7012b973ba07f1))
- strengthen maintainability failure guidance ([0cb0193](https://github.com/MakerXStudio/complexity-verifier/commit/0cb01934bbd199142ca23d2927df472d0ef70737))
