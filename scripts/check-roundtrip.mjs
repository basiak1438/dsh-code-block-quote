/**
 * Cross-plugin round trip: does dsh-client-ui-quote read our wire form back
 * into exactly the code we quoted?
 *
 *   node scripts/check-roundtrip.mjs
 *
 * Loads the installed `dsh-client-ui-quote`'s client bundle, takes its
 * `__testing.quoteBlock` / `__testing.splitQuoteRuns` pair (the same code the
 * transcript capsule renderer uses) and feeds it every payload this plugin's
 * `quoteBlock` can emit. No dependency on the plugin being a package export of
 * ours: the path is resolved from the profile that has it installed.
 *
 * Skips cleanly when dsh-client-ui-quote is not installed.
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OURS = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

const CANDIDATES = [
  process.env.DSH_UI_QUOTE_CLIENT,
  join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-client-ui-quote', 'lib', 'client.js')
].filter(Boolean)

const theirClient = CANDIDATES.find((path) => existsSync(path))
if (theirClient === undefined) {
  console.log('skip  dsh-client-ui-quote is not installed; nothing to round-trip against')
  process.exit(0)
}

/* ---------------------------------------------------------------- *
 * Load both bundles against a stub window
 * ---------------------------------------------------------------- */

function loadBundle(source, id) {
  const loaded = { exports: null }
  const window = {
    __ModuleLoader__: {
      load(descriptor) {
        loaded.exports = descriptor.factory((name) => {
          if (name === 'react') return {}
          // The host's own modules; the pure helpers never touch them.
          return {}
        })
      }
    },
    document: undefined,
    location: { href: 'http://localhost/' },
    navigator: { language: 'zh-CN' },
    localStorage: { getItem: () => null, setItem: () => {} },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    addEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} })
  }
  const previous = globalThis.window
  globalThis.window = window
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'navigator', 'localStorage', source)(window, window.document, window.navigator, window.localStorage)
  } finally {
    globalThis.window = previous
  }
  return loaded.exports
}

const theirs = loadBundle(readFileSync(theirClient, 'utf8'), 'dsh-client-ui-quote')
const ours = loadBundle(OURS, 'dsh-code-block-quote')

if (theirs?.__testing?.splitQuoteRuns === undefined) {
  console.log('skip  dsh-client-ui-quote exposes no __testing.splitQuoteRuns')
  process.exit(0)
}

const theirSplit = theirs.__testing.splitQuoteRuns
const ourQuoteBlock = ours.__testing.quoteBlock

/* ---------------------------------------------------------------- *
 * The cases: every shape our button can produce
 * ---------------------------------------------------------------- */

const CASES = [
  {
    name: 'plain python',
    code: 'def greet(name):\n    return "hi " + name',
    lang: 'python'
  },
  {
    name: 'no language tag',
    code: 'plain text\nsecond line',
    lang: null
  },
  {
    name: 'code containing a ``` fence',
    code: 'before\n```js\nconst a = 1\n```\nafter',
    lang: 'markdown'
  },
  {
    name: 'line starting with \\ (escape char)',
    code: '\\n literal backslash-n\n\\t literal tab',
    lang: 'text'
  },
  {
    name: 'line starting with ❞ (comment mark)',
    code: '\u275E this line starts with the comment mark',
    lang: 'text'
  },
  {
    name: 'line starting with ※ (reply mark)',
    code: '\u203B this line starts with the reply mark',
    lang: 'text'
  },
  {
    name: 'line starting with ❝ (quote mark)',
    code: '\u275D this line starts with the quote mark',
    lang: 'text'
  },
  {
    name: 'trailing blank lines and trailing spaces',
    code: 'line one   \nline two\n\n\n',
    lang: 'text'
  },
  {
    name: 'indented body',
    code: 'def f():\n    if x:\n        return 1\n    return 0',
    lang: 'python'
  },
  {
    name: 'empty-ish block (only blank lines)',
    code: '   \n\n  ',
    lang: 'text'
  },
  {
    name: 'chinese and full-width punctuation',
    code: 'café = "你好，世界！"\n# 注释：全角标点（）【】',
    lang: 'python'
  }
]

let failures = 0

for (const item of CASES) {
  const wire = ourQuoteBlock(item.code, item.lang)

  if (wire === '') {
    // An all-blank block is deliberately refused by the button, not emitted.
    console.log('ok    ' + item.name + ' — refused (empty after trimming), no wire form')
    continue
  }

  const full = '>\u0020' + wire.split('\n').slice(0, 0).join('\n') // no-op; keep the wire as-is
  const segments = theirSplit(wire)
  if (segments === null) {
    console.error('FAIL  ' + item.name + ' — the reader found no quote at all')
    console.error(wire)
    failures += 1
    continue
  }

  const quotes = segments.filter((segment) => segment.type === 'quote')
  if (quotes.length !== 1) {
    console.error('FAIL  ' + item.name + ' — expected 1 quote segment, got ' + quotes.length)
    for (const segment of quotes) console.error('   ', JSON.stringify(segment).slice(0, 200))
    failures += 1
    continue
  }

  const read = quotes[0]
  const expected = item.code.split('\n').map((line) => line.replace(/\s+$/, '')).join('\n').replace(/\s+$/, '')
  const got = String(read.quote).replace(/\s+$/u, '')

  // The fence language comes back as `code` ('' when the fence had no tag).
  const wantLang = item.lang ?? ''
  if (read.code !== wantLang) {
    console.error('FAIL  ' + item.name + ' — language read back as ' + JSON.stringify(read.code) + ', want ' + JSON.stringify(wantLang))
    failures += 1
    continue
  }

  if (got !== expected) {
    console.error('FAIL  ' + item.name + ' — body mismatch')
    console.error('  want: ' + JSON.stringify(expected))
    console.error('  got : ' + JSON.stringify(got))
    failures += 1
    continue
  }

  console.log('ok    ' + item.name + ' — one quote, language ' + JSON.stringify(read.code) + ', body intact')
}

/* ---------------------------------------------------------------- *
 * The comment half must stay empty: our button never emits one.
 * ---------------------------------------------------------------- */

{
  const wire = ourQuoteBlock('a\nb', 'text')
  const segments = theirSplit(wire)
  const quote = segments?.find((segment) => segment.type === 'quote')
  if (quote === undefined || quote.comment !== '') {
    console.error('FAIL  a code quote leaked into the comment half')
    failures += 1
  } else {
    console.log('ok    the comment half stays empty')
  }
}

/* ---------------------------------------------------------------- *
 * Loose text after a quote must survive as its own segment.
 * ---------------------------------------------------------------- */

{
  const wire = ourQuoteBlock('x = 1', 'python')
  const message = wire + '\n\n为什么这里要用 1？'
  const segments = theirSplit(message)
  const texts = segments?.filter((segment) => segment.type === 'text') ?? []
  if (texts.length !== 1 || !texts[0].text.includes('为什么这里要用 1？')) {
    console.error('FAIL  trailing question did not survive as loose text')
    console.error(JSON.stringify(segments))
    failures += 1
  } else {
    console.log('ok    a question typed after the quote stays its own text segment')
  }
}

if (failures > 0) {
  console.error('\n' + failures + ' case(s) failed')
  process.exit(1)
}
console.log('\nall round trips passed against the installed dsh-client-ui-quote')
