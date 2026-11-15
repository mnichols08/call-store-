# Zubra under stress

What came out of pushing Zubra 5.17.0 as hard as this app can: `test/zubra-stress.test.js` (edge cases, runs with `npm test`) and `stress/bench.js` (speed and memory, `npm run stress`). The fixtures it renders are in `test/fixtures/components`.

## A bug it found in this app (fixed)

Text trimmed to a length limit could cut an emoji in half. Zubra's renderer throws on half a surrogate pair, so one such call note turned every page that showed it into an error page. Fixed three ways: input is made well-formed when a form is read (`src/web/server.js`); trimming never splits a character (`clip` in `src/domain/text.js`, used by every length limit); and every string reaching a component is cleaned (`src/web/ui.js`). A test saves text cut at each field's limit and loads every page.

## Things worth fixing in Zubra

Each is pinned by a test, so the behaviour is recorded and a change shows up.

1. **Half a surrogate pair in a prop throws `the request isn't JSON: unexpected end of hex escape at line 1 column 107`.** It names neither the component nor the prop. The compiler's JSON request seems to carry the lone `\ud83d` escape and the other side refuses it. Suggest `toWellFormed()` on strings going in, or at least an error that names the prop.
2. **A slot is compiled as markup, and a mistake in it reports the wrong place.** `<script>` and `onerror` pass straight through (marked `data-zb-slotted`), so callers must escape. Unbalanced markup (`a & b <i>`) or an unterminated `<!--` throws, and the error points at a line of the *component's* file (`row-item.zb:87:3` in a ten-line file). Suggest a text form for a slot (`{ text: '…' }`) that escapes for you, and positions that say "in slot content".
3. **A failed render of an unknown component leaves the page unable to finish.** `render` records the name as used before checking it exists, so a later `finish()` throws. An error page built on the same page object can't be sent. (A bad *prop* doesn't do this.)
4. **Odd prop values give uneven errors.** `null`, numbers, booleans, arrays and objects are refused with a clear "must be a string" (good). `NaN` and `Infinity` say "found null" (they went through JSON). A `BigInt` says `Do not know how to serialize a BigInt` with no component or prop. Functions, symbols and dates render without complaint.
5. **Streaming has no timeout.** A promise that never settles keeps the response open for ever (the first chunk, the shell, still goes out at once). Callers must bound slow promises themselves.
6. **A rejected promise's message goes to the browser as written** (escaped, so it's safe, but a database error would be shown). A rejection that isn't an `Error` shows as `[object Object]`.

## What held up

- Hostile text in every string prop of every component (script tags, quote breakouts, `{{ }}`, `${ }`, comment openers, right-to-left marks, emoji sequences, 100 KB strings) never becomes markup.
- A component declares its props and slots, and Zubra refuses anything else with a clear message (`unknown prop 'notAProp'`, `slot 'nope' is not declared`).
- A nonce that couldn't be one (quotes, spaces, `>`, newlines, empty) is refused when the page is made, not mid-response.
- Two hundred pages rendered at once never share a nonce, id counter or component list; forty fields on one page get forty distinct ids, each label pointing at its own input.
- Streamed values that try to close the script carrying them (`</script>`, `<!--`, U+2028, `]]>`) stay data; every swap script carries the page's nonce. Values arrive in the order they settle; rejections become messages.
- Prototype keys (`__proto__`, `constructor`) as prop or slot names pollute nothing.
- Twenty thousand `<option>`s, five thousand siblings in a slot and sixty nested components render. Markup more than 256 elements deep is refused with advice to flatten.

## Speed and memory (this machine, production mode)

| Test | Result |
| --- | --- |
| 20,000 `row-item` on one page | 515 ms (26 µs each, 3.9 MB), time grows in a straight line |
| 2,000 `text-field` | 93 ms |
| A 1 MB slot | 18 ms |
| 1,000 whole pages of three components | 59 ms (about 17,000 pages a second) |
| Streaming 500 promises resolving in random order | 78 ms, 501 chunks |
| 10,000 pages, heap before then after | 5.9 MB then 6.2 MB (no leak) |
| First render of a component, then the next | 1 ms then 0.1 ms |
