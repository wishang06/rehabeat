# Music credits

The game plays **"Past Sadness" by Kevin MacLeod**, split into a drum stem and a melody stem
(`public/stems/drums.mp3`, `public/stems/melody.mp3`). `public/beatmap.json` is its beat grid.

| Track | Artist | Source | Licence | BPM | File |
| --- | --- | --- | --- | --- | --- |
| Past Sadness (used in the game) | Kevin MacLeod | [incompetech.com](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900007) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 72.00 | `tools/tracks/kevin-macleod-past-sadness.mp3` |
| Dirty shoes blues | Loyalty Freak Music | [Free Music Archive](https://freemusicarchive.org/music/Loyalty_Freak_Music/INSTRUMENTAL_RB_BEATS_TO_SING_OR_RAP_ON/Loyalty_Freak_Music_-_INSTRUMENTAL_RB_BEATS_TO_SING_OR_RAP_ON_-_04_Dirty_shoes_blues) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 64.99 | `tools/tracks/loyalty-freak-music-dirty-shoes-blues.mp3` |
| The Past (8 Bit Lofi Hip Hop) | TAD | [OpenGameArt](https://opengameart.org/content/the-past-8-bit-lofi-hip-hop) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (also offered under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) | 70.00 | `tools/tracks/tad-the-past-8-bit-lofi-hip-hop.mp3` |

Licences are as stated on each source page on 2026-11-14. BPM is measured from the file by
`tools/make_beatmap.py`.

## Attribution (required for "Past Sadness")

"Past Sadness" by Kevin MacLeod ([incompetech.com](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900007)),
licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Split into drum and melody stems for this game.

Plain text, for an in-game credits screen:

```
"Past Sadness" by Kevin MacLeod (incompetech.com)
Licensed under Creative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/
Split into drum and melody stems for this game.
```

CC BY 4.0 asks you to say when the audio has been changed, which is what the last line does.
The two CC0 tracks need no attribution; they are listed as a courtesy.

## Notes on the other two tracks

- **Dirty shoes blues**: the Free Music Archive download needs a login, so the file comes from the
  [Internet Archive copy](https://archive.org/details/LoyaltyFreakMusic-INSTRUMENTALRBBEATSTOSINGORRAPON)
  of the same release. The artist's [own album page](https://loyaltyfreakmusic.com/music/instrumental-rb-beats-to-sing-or-rap-on/)
  also marks it CC0.
- **The Past**: the licence is the one the uploader chose on OpenGameArt. The file was made in
  GarageBand, and the author says of [another of their uploads](https://opengameart.org/content/lofi-compilation)
  that its looped sounds come from Apple's GarageBand. Apple lets you distribute a finished track
  made with its loops, but not the loops on their own. Playing the whole track is fine; ask the
  author before shipping a separated drum stem of it.

<!-- songs:start -->
## Song library

Every song in `public/songs/`, written by `npm run songs`: it rewrites this section on every
add, remove or move, so change the songs with that command rather than here.

| Song | Artist | Catalogue | Licence | Source |
| --- | --- | --- | --- | --- |
| Wetlands | HoliznaCC0 | Calm Stretch | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [freemusicarchive.org](https://freemusicarchive.org/music/holiznacc0/public-domain-lofi/wetlands-lofi-calm-relaxed/) |
| Stealth Groover | Kevin MacLeod | Calm Stretch | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [incompetech.com](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100690) |
| Past Sadness | Kevin MacLeod | Steady Flow | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [incompetech.com](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900007) |
| Dreamy Reverie | HoliznaCC0 | Steady Flow | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [freemusicarchive.org](https://freemusicarchive.org/music/holiznacc0/public-domain-lofi/dreamy-reverie-lofi-nostalgic-chill/) |
| Saturation | HoliznaCC0 | Active Rehab | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [freemusicarchive.org](https://freemusicarchive.org/music/holiznacc0/public-domain-lofi/saturation-lofi-calm-relaxed/) |

Credit lines, as the game shows them:

- `wetlands`: "Wetlands" by HoliznaCC0 (freemusicarchive.org), CC0 1.0. Separated into drum and melody stems by the Rehabeat team.
- `stealth-groover`: "Stealth Groover" by Kevin MacLeod (incompetech.com), CC BY 4.0. Separated into drum and melody stems by the Rehabeat team.
- `past-sadness`: "Past Sadness" by Kevin MacLeod (incompetech.com), CC BY 4.0. Separated into drum and melody stems by the Rehabeat team.
- `dreamy-reverie`: "Dreamy Reverie" by HoliznaCC0 (freemusicarchive.org), CC0 1.0. Separated into drum and melody stems by the Rehabeat team.
- `saturation`: "Saturation" by HoliznaCC0 (freemusicarchive.org), CC0 1.0. Separated into drum and melody stems by the Rehabeat team.
<!-- songs:end -->
