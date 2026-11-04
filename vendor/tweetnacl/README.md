# tweetnacl 1.0.3 (unmodified)

`nacl-fast.min.js`, `LICENSE` and `package.json` from the npm package tweetnacl@1.0.3 (public domain, The Unlicense;
https://github.com/dchest/tweetnacl-js), as fetched from the npm registry (`npm pack tweetnacl@1.0.3`, integrity
`sha512-6rt+RN7aOi1nGMyC4Xa5DdYiukl2UWCbcJft7YhxReBGQD7OAM8Pbxw6YMo4r2diNEA8FEmu32YOn9rhaiE5yw==`). `nacl-fast.min.js`
SHA-256: `3ec535c004aeeb225785d8e93fb33bf99f52e399bd7dfc01969b5629baea5131` (checked by `tests/page-updates.test.mjs`).
The same copy hometv-tizen uses.

The page updater (`app/loader/update.js`) loads it after Home shows, to check the manifest's Ed25519 signature and
the files' SHA-512 hashes: LG's older web engines (Chromium 38-120) have no Ed25519 in WebCrypto. Don't edit; replace
with a newer release instead.
