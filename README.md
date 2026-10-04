# FreeRangeShows

A separate PWA from FreeRangeMedia. Nights you attended or want. No account. No server.

Local only until Micah says to put it on GitHub. The repo FreeRangeIce/free-range-shows did not exist when this branch was made, and this commit was not pushed.

## Guards

- Library key: `freerangeshows-v1`. API keys: `freerangeshows-keys`. Neither is a Media Shelf key.
- Backup `app` is `free-range-shows`. Any other file, including `freerangemedia` and `media-shelf`, is refused. A bare array is refused.
- Restore asks before it replaces every night.
- Backups do not include API keys.
- This site and FreeRangeMedia share `freerangeice.github.io`. Clearing site data in the browser removes both keys. Separate keys do not stop that.

## Not in this commit

The link back from FreeRangeMedia is not added there. Public wording marked PLACEHOLDER is for Berean.
