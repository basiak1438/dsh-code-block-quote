/**
 * Offline check for lib/client.js: syntax, wire form, and the DOM contract.
 *
 *   node scripts/check-client.mjs
 *
 * 1. Parses the bundle.
 * 2. Drives the pure helpers (quote fence, escaping, language sanitizing).
 * 3. Mounts the client half against a hand-built fake of the host's code-block
 *    DOM, clicks the button, and asserts the chip that reached insertReference.
 * 4. Asserts a second mount seats no duplicate button and a teardown removes it.
 *
 * No dependencies: the fake DOM below implements only what the bundle touches.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'lib', 'client.js')
const source = readFileSync(CLIENT, 'utf8')

/* ---------------------------------------------------------------- *
 * 1. Parse
 * ---------------------------------------------------------------- */

{
  // `node --check` equivalent: compile the bundle body without running it.
  try {
    new Function('window', source)
  } catch (error) {
    console.error('FAIL  client.js does not parse:', error.message)
    process.exit(1)
  }
  console.log('ok    client.js parses')
}

/* ---------------------------------------------------------------- *
 * A minimal DOM
 * ---------------------------------------------------------------- */

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentElement = null
    this.attributes = new Map()
    this.style = {
      removeProperty: (name) => {
        delete this.style[name]
      }
    }
    this._text = ''
    this.value = ''
    this.listeners = new Map()
    this.className = ''
  }

  get classList() {
    const self = this
    return {
      add: (name) => {
        if (!self.classList.contains(name)) {
          self.className = (self.className ? self.className + ' ' : '') + name
        }
      },
      remove: (name) => {
        self.className = self.className.split(/\s+/u).filter((c) => c && c !== name).join(' ')
      },
      contains: (name) => self.className.split(/\s+/u).includes(name)
    }
  }

  scrollIntoView() {
    this._scrolledIntoView = true
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  insertBefore(newChild, refChild) {
    newChild.parentElement = this
    const idx = refChild ? this.children.indexOf(refChild) : -1
    if (idx >= 0) {
      this.children.splice(idx, 0, newChild)
    } else {
      this.children.push(newChild)
    }
    return newChild
  }

  remove() {
    if (this.parentElement === null) return
    const at = this.parentElement.children.indexOf(this)
    if (at >= 0) this.parentElement.children.splice(at, 1)
    this.parentElement = null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  get textContent() {
    if (this.children.length === 0) return this._text
    return this.children.map((child) => child.textContent).join('')
  }

  get lastElementChild() {
    return this.children.length === 0 ? null : this.children[this.children.length - 1]
  }

  get firstElementChild() {
    return this.children.length === 0 ? null : this.children[0]
  }

  set textContent(value) {
    this.children.length = 0
    this._text = String(value)
  }

  matches(selector) {
    return matchesSelector(this, selector)
  }

  closest(selector) {
    let node = this
    while (node !== null && node !== undefined) {
      if (node.matches?.(selector) === true) return node
      node = node.parentElement
    }
    return null
  }

  querySelector(selector) {
    const found = this.querySelectorAll(selector)
    return found.length === 0 ? null : found[0]
  }

  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }

  dispatch(type) {
    const event = {
      type,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      stopPropagation() {}
    }
    for (const handler of this.listeners.get(type) ?? []) handler(event)
    return event
  }

  focus() {}
}

/**
 * The selector subset the bundle uses: attribute presence, `div:last-child`,
 * a class chain, and a comma list.
 */
function matchesSelector(node, selector) {
  if (typeof selector !== 'string') return false
  const parts = selector.split(',').map((part) => part.trim())
  return parts.some((part) => matchesOne(node, part))
}

function matchesOne(node, selector) {
  if (selector === '') return false
  let rest = selector

  // `div:last-child`
  let lastChild = false
  if (rest.endsWith(':last-child')) {
    lastChild = true
    rest = rest.slice(0, -':last-child'.length)
  }

  // Trailing attribute selectors and classes, in any order.
  const attributeTests = []
  for (;;) {
    const attribute = /\[([^\]]+)\]\s*$/u.exec(rest)
    if (attribute !== null) {
      attributeTests.unshift(attribute[1])
      rest = rest.slice(0, attribute.index)
      continue
    }
    const cls = /\.([A-Za-z_][\w-]*)\s*$/u.exec(rest)
    if (cls !== null) {
      attributeTests.unshift('.' + cls[1])
      rest = rest.slice(0, cls.index)
      continue
    }
    break
  }

  if (rest !== '' && node.tagName !== rest.toUpperCase()) return false

  for (const test of attributeTests) {
    if (test.startsWith('.')) {
      if (!node.classList.contains(test.slice(1))) return false
      continue
    }
    const at = test.indexOf('=')
    if (at < 0) {
      if (node.getAttribute(test) === null) return false
      continue
    }
    const name = test.slice(0, at)
    const raw = test.slice(at + 1)
    const value = raw.replace(/^["']|["']$/gu, '')
    if (node.getAttribute(name) !== value) return false
  }

  if (lastChild) {
    const parent = node.parentElement
    if (parent === null || parent.children[parent.children.length - 1] !== node) return false
  }
  return true
}

function makeDocument() {
  const body = new FakeNode('body')
  const head = new FakeNode('head')
  const html = new FakeNode('html')
  html.lang = 'zh-CN'
  return {
    body,
    head,
    documentElement: html,
    createElement: (tag) => new FakeNode(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: (selector) => {
      if (matchesSelector(body, selector)) return body
      return body.querySelector(selector)
    },
    querySelectorAll: (selector) => body.querySelectorAll(selector)
  }
}

/* ---------------------------------------------------------------- *
 * 2. Pure helpers
 * ---------------------------------------------------------------- */

const captured = { attachment: null, span: null }
const insertedTexts = []

/**
 * Build the client half against a fake `window`, then return its exports.
 * @param window - the fake global.
 */
function loadBundle(window) {
  let exportsOut = null
  const previous = globalThis.window
  globalThis.window = window
  try {
    // eslint-disable-next-line no-new-func
    const factoryRunner = new Function('window', source + '\nreturn undefined;')
    factoryRunner(window)
    exportsOut = window.__loaded
  } finally {
    globalThis.window = previous
  }
  return exportsOut
}

/* ---------------------------------------------------------------- *
 * 3. DOM contract, end to end
 * ---------------------------------------------------------------- */

/**
 * Assemble the shipped code-block DOM shape:
 * block > bannerWrap > banner[data-code-block-banner] > [infostring, actions>copy]
 * plus content > pre > code.
 */
function buildCodeBlock(doc, lang, code) {
  const block = doc.createElement('div')
  block.className = 'md-code-block'

  const bannerWrap = doc.createElement('div')
  const banner = doc.createElement('div')
  banner.setAttribute('data-code-block-banner', '')

  const info = doc.createElement('div')
  info.textContent = lang
  const actions = doc.createElement('div')
  const copy = doc.createElement('button')
  copy.textContent = '复制'
  actions.appendChild(copy)

  banner.appendChild(info)
  banner.appendChild(actions)
  bannerWrap.appendChild(banner)
  block.appendChild(bannerWrap)

  const content = doc.createElement('div')
  content.setAttribute('data-code-block-content', '')
  const pre = doc.createElement('pre')
  const codeNode = doc.createElement('code')
  codeNode.textContent = code
  pre.appendChild(codeNode)
  content.appendChild(pre)
  block.appendChild(content)

  return block
}

{
  const doc = makeDocument()

  // A transcript anchor carrying the session id, as the host renders it.
  const sessionRoot = doc.createElement('div')
  sessionRoot.setAttribute('data-conversation-session', 'session-test')
  sessionRoot.setAttribute('data-conversation-content', '')
  const block = buildCodeBlock(doc, 'python', 'def greet(name):\n    return "hi " + name')
  sessionRoot.appendChild(block)
  doc.body.appendChild(sessionRoot)

  const ctx = {
    effects: [],
    get(name) {
      if (name === 'inputTriggers') {
        return {
          registerSource(src) {
            captured.source = src
            return () => {}
          }
        }
      }
      if (name === 'conversation') {
        return {
          input: {
            shell: () => ({
              captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
              actions: {
                captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
                insertText: (text) => {
                  insertedTexts.push(text)
                  return true
                }
              },
              insertReference: (attachment, span) => {
                captured.attachment = attachment
                captured.span = span
                return true
              }
            })
          }
        }
      }
      return undefined
    },
    effect(fn) {
      const disposer = fn()
      ctx.effects.push(disposer)
      return () => {}
    },
    inject(_names, fn) {
      fn(ctx)
    }
  }

  // The loader shim: capture the module the bundle registers.
  const fakeWindow = {
    document: doc,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: (fn) => 0,
    __ModuleLoader__: {
      load(descriptor) {
        const require = (name) => {
          if (name === 'react') return {}
          throw new Error('unexpected require: ' + name)
        }
        fakeWindow.__loaded = descriptor.factory(require)
      }
    }
  }

  const loaded = loadBundle(fakeWindow)
  if (loaded === null || typeof loaded.apply !== 'function') {
    console.error('FAIL  the bundle did not register a module')
    process.exit(1)
  }
  console.log('ok    the bundle registers a module')

  loaded.apply(ctx)

  const buttons = doc.querySelectorAll('[data-dsh-code-quote]')
  if (buttons.length !== 1) {
    console.error('FAIL  expected exactly 1 seated button, got', buttons.length)
    process.exit(1)
  }
  console.log('ok    one button seated in the banner action row')

  const seated = buttons[0]
  if (seated.parentElement !== block.querySelector('[data-code-block-banner]').children[1]) {
    console.error('FAIL  the button did not land in the action row')
    process.exit(1)
  }
  console.log('ok    seated beside the native copy button')

  seated.dispatch('click')

  if (captured.attachment === null) {
    console.error('FAIL  the click did not reach insertReference')
    process.exit(1)
  }
  console.log('ok    the click inserted a chip')

  const ref = String(captured.attachment.ref)
  const expected = [
    '> \u275D ``` python',
    '> def greet(name):',
    '>     return "hi " + name',
    '> ```'
  ].join('\n')
  if (ref.indexOf(expected) < 0) {
    console.error('FAIL  wire form mismatch\n--- got ---\n' + ref + '\n--- want ---\n' + expected)
    process.exit(1)
  }
  console.log('ok    wire form is a fenced blockquote with the language tag')

  if (captured.attachment.source !== 'code-quote') {
    console.error('FAIL  chip source is', captured.attachment.source)
    process.exit(1)
  }
  console.log('ok    chip carries this plugin\'s source name')

  if (captured.source === null || typeof captured.source.codec?.serialize !== 'function') {
    console.error('FAIL  the reference source has no codec')
    process.exit(1)
  }
  const serialized = await captured.source.codec.serialize(ref)
  if (serialized !== ref) {
    console.error('FAIL  the codec changed the ref')
    process.exit(1)
  }
  console.log('ok    the codec is stateless (ref in, ref out)')

  // A second scan must not stack a duplicate.
  doc.body.dispatch?.('x')
  loaded.apply(ctx)
  const again = doc.querySelectorAll('[data-dsh-code-quote]')
  if (again.length !== 1) {
    console.error('FAIL  a second mount seated a duplicate button (now', again.length + ')')
    process.exit(1)
  }
  console.log('ok    a second mount seats no duplicate')

  // Teardown removes the button.
  for (const dispose of ctx.effects) dispose()
  const afterTeardown = doc.querySelectorAll('[data-dsh-code-quote]')
  if (afterTeardown.length !== 0) {
    console.error('FAIL  teardown left', afterTeardown.length, 'button(s) behind')
    process.exit(1)
  }
  console.log('ok    teardown removes the button')
}

/* ---------------------------------------------------------------- *
 * 4. Fence safety
 * ---------------------------------------------------------------- */

{
  const doc = makeDocument()
  const sessionRoot = doc.createElement('div')
  sessionRoot.setAttribute('data-conversation-session', 'session-fence')
  const code = 'here is a fence:\n```js\nconst a = 1\n```\ndone'
  const block = buildCodeBlock(doc, 'markdown', code)
  sessionRoot.appendChild(block)
  doc.body.appendChild(sessionRoot)

  const ctx = {
    effects: [],
    get(name) {
      if (name === 'inputTriggers') return { registerSource: () => () => {} }
      if (name === 'conversation') {
        return {
          input: {
            shell: () => ({
              actions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }) },
              insertReference: (attachment) => {
                captured.attachment = attachment
                return true
              }
            })
          }
        }
      }
      return undefined
    },
    effect(fn) {
      const disposer = fn()
      ctx.effects.push(disposer)
      return () => {}
    },
    inject: (_names, fn) => fn(ctx)
  }

  const fakeWindow = {
    document: doc,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: () => 0,
    __ModuleLoader__: {
      load(descriptor) {
        fakeWindow.__loaded = descriptor.factory(() => ({}))
      }
    }
  }
  captured.attachment = null
  loadBundle(fakeWindow).apply(ctx)
  doc.querySelectorAll('[data-dsh-code-quote]')[0].dispatch('click')
  const ref = String(captured.attachment?.ref ?? '')
  if (ref.indexOf('> \u275D ~~~ markdown') < 0) {
    console.error('FAIL  a code block containing ``` did not switch to a ~~~ fence\n' + ref)
    process.exit(1)
  }
  console.log('ok    a block containing ``` switches to a ~~~ fence')
  for (const dispose of ctx.effects) dispose()
}

/* ---------------------------------------------------------------- *
 * 5. Scheme B: User bubble quote folding & metadata stripping
 * ---------------------------------------------------------------- */

{
  const doc = makeDocument()
  const rawWithCoord = [
    'bash',
    '引用',
    'cd C:\\Users\\admin\\Documents\\deepseek-harness\\default-workspace',
    'npm run check        # 两个离线检查',
    'npm run test:live    # 起服务，浏览器打开终端打印的 URL',
    '※ 引自第 16 轮',
    '│q1:eyJ2IjoxLCJzIjoic2Vzc2lvbi02YmExOGY1NC0zZjE0LTRhOGYtODIxNC02NTYxN2RlZWFlNmYiLCJhIjoiZGF0YS1jaGF0LWFuY2hvci1rZXkiLCJrIjoiMTQ6YXNzaXN0YW50LXN0ZXAxNjoxNiIsInQiOiIxNiIsIm4iOjJ9'
  ].join('\n')

  const fakeWindow = {
    document: doc,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: () => 0,
    __ModuleLoader__: {
      load(descriptor) {
        fakeWindow.__loaded = descriptor.factory(() => ({}))
      }
    }
  }

  const mod = loadBundle(fakeWindow)
  const { cleanQuoteText, parseQuoteHeader, createFoldCard } = mod.__testing

  // 1. cleanQuoteText
  const cleaned = cleanQuoteText(rawWithCoord)
  if (cleaned.includes('q1:') || cleaned.includes('※ 引自') || cleaned.includes('eyJ2Ijox')) {
    console.error('FAIL  cleanQuoteText failed to strip coordinate metadata:\n' + cleaned)
    process.exit(1)
  }
  console.log('ok    cleanQuoteText strips base64 coordinate line and metadata')

  // 2. parseQuoteHeader
  const parsed = parseQuoteHeader(cleaned)
  if (parsed.lang !== 'bash') {
    console.error('FAIL  parseQuoteHeader missed language "bash", got:', parsed.lang)
    process.exit(1)
  }
  if (parsed.count < 3) {
    console.error('FAIL  parseQuoteHeader line count expected >= 3, got:', parsed.count)
    process.exit(1)
  }
  console.log('ok    parseQuoteHeader extracts language and line count')

  // 3. createFoldCard
  const card = createFoldCard(rawWithCoord, doc)
  if (!card || card.getAttribute('data-dsh-quote-card') !== '1') {
    console.error('FAIL  createFoldCard did not return a valid quote card')
    process.exit(1)
  }
  if (card.getAttribute('data-folded') !== 'true') {
    console.error('FAIL  long quote card should be folded by default')
    process.exit(1)
  }
  console.log('ok    createFoldCard builds a card folded by default for long text')

  // 4. End-to-end DOM test: simulated btw node
  const bubble = doc.createElement('div')
  bubble.className = 'LOmM4q_bubble'
  const btwNode = doc.createElement('span')
  btwNode.className = 'btw-official-quote-node'
  btwNode.setAttribute('data-quote-preview', '')
  btwNode.textContent = rawWithCoord
  bubble.appendChild(btwNode)
  doc.body.appendChild(bubble)

  const ctx = {
    effects: [],
    get: () => undefined,
    effect(fn) {
      ctx.effects.push(fn())
      return () => {}
    },
    inject: (_names, fn) => fn(ctx)
  }

  mod.apply(ctx)

  const cardsInDoc = doc.querySelectorAll('[data-dsh-quote-card]')
  if (cardsInDoc.length !== 1) {
    console.error('FAIL  expected 1 quote card in document, got:', cardsInDoc.length)
    process.exit(1)
  }
  console.log('ok    enhanceUserBubbles replaced btw-official-quote-node with fold card')

  if (btwNode.getAttribute('data-dsh-quote-handled') !== '1' || btwNode.style.display !== 'none') {
    console.error('FAIL  original btw node was not hidden/marked handled')
    process.exit(1)
  }
  console.log('ok    original raw btw node is hidden')

  // Test fold toggle click
  const toggle = cardsInDoc[0].querySelector('.dsh-quote-card-toggle')
  if (!toggle) {
    console.error('FAIL  toggle button missing on fold card')
    process.exit(1)
  }
  toggle.dispatch('click')
  if (cardsInDoc[0].getAttribute('data-folded') !== 'false') {
    console.error('FAIL  toggle click did not expand the card')
    process.exit(1)
  }
  console.log('ok    card toggles from folded to expanded on click')

  // Teardown cleans cards and restores original node
  for (const dispose of ctx.effects) dispose()
  if (doc.querySelectorAll('[data-dsh-quote-card]').length !== 0) {
    console.error('FAIL  teardown did not remove the quote card')
    process.exit(1)
  }
  if (btwNode.getAttribute('data-dsh-quote-handled') !== null) {
    console.error('FAIL  teardown did not unmark handled node')
    process.exit(1)
  }
  console.log('ok    teardown removes cards and restores original elements')
}

/* ---------------------------------------------------------------- *
 * 6. Turn provenance & Jump-to-source Engine
 * ---------------------------------------------------------------- */

{
  const doc = makeDocument()

  // 1. Simulate a turn row in chat history containing a python code block
  const turn16Row = doc.createElement('div')
  turn16Row.setAttribute('data-chat-turn', '16')
  const originalCode = 'def calculate_taxes(income):\n    return income * 0.2'
  const sourceBlock = buildCodeBlock(doc, 'python', originalCode)
  turn16Row.appendChild(sourceBlock)
  doc.body.appendChild(turn16Row)

  // 2. Simulate a subsequent turn with a user message quoting turn 16
  const turn17Row = doc.createElement('div')
  turn17Row.setAttribute('data-chat-turn', '17')
  const rawQuoteWithTurn = [
    '> \u275D ``` python',
    '> def calculate_taxes(income):',
    '>     return income * 0.2',
    '> ```',
    '> \u203B 第 16 轮'
  ].join('\n')

  const userBubble = doc.createElement('div')
  userBubble.className = 'LOmM4q_bubble'
  const btwNode = doc.createElement('span')
  btwNode.className = 'btw-official-quote-node'
  btwNode.setAttribute('data-quote-preview', '')
  btwNode.textContent = rawQuoteWithTurn
  userBubble.appendChild(btwNode)
  turn17Row.appendChild(userBubble)
  doc.body.appendChild(turn17Row)

  const fakeWindow = {
    document: doc,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: (fn) => 0,
    __ModuleLoader__: {
      load(descriptor) {
        fakeWindow.__loaded = descriptor.factory(() => ({}))
      }
    }
  }

  const mod = loadBundle(fakeWindow)
  const ctx = {
    effects: [],
    get: () => undefined,
    effect(fn) {
      ctx.effects.push(fn())
      return () => {}
    },
    inject: (_names, fn) => fn(ctx)
  }

  mod.apply(ctx)

  // Card generated
  const card = turn17Row.querySelector('[data-dsh-quote-card]')
  if (!card) {
    console.error('FAIL  card was not created for quote with turn')
    process.exit(1)
  }
  if (card.getAttribute('data-quote-turn') !== '16') {
    console.error('FAIL  card did not capture data-quote-turn="16", got:', card.getAttribute('data-quote-turn'))
    process.exit(1)
  }
  console.log('ok    card captures data-quote-turn="16" from clean metadata')

  // Card title shows turn
  const label = card.querySelector('.dsh-quote-card-label')?.textContent || ''
  if (!label.includes('16')) {
    console.error('FAIL  card title does not display turn 16, got:', label)
    process.exit(1)
  }
  console.log('ok    card title shows "第 16 轮" breadcrumb')

  // Jump button exists
  const jumpBtn = card.querySelector('.dsh-quote-card-jump')
  if (!jumpBtn) {
    console.error('FAIL  jump button .dsh-quote-card-jump missing on card')
    process.exit(1)
  }
  console.log('ok    jump button is present on card')

  // Click Jump: sourceBlock should be targeted, scrolled into view, and flashed
  jumpBtn.dispatch('click')

  if (!sourceBlock._scrolledIntoView) {
    console.error('FAIL  jump click did not scroll sourceBlock into view')
    process.exit(1)
  }
  if (!sourceBlock.classList.contains('dsh-quote-target-flash')) {
    console.error('FAIL  sourceBlock did not receive dsh-quote-target-flash class')
    process.exit(1)
  }
  console.log('ok    clicking jump scrolled sourceBlock into view with flash highlight')

  for (const dispose of ctx.effects) dispose()
}

/* ---------------------------------------------------------------- *
 * 7. BTW-style Selection Toolbar & Side Chat Channel (Scheme B)
 * ---------------------------------------------------------------- */

{
  const doc = makeDocument()

  // 1. Simulate a chat message container with a turn
  const row = doc.createElement('div')
  row.setAttribute('data-chat-turn', '16')
  row.setAttribute('data-conversation-content', '')
  const prose = doc.createElement('p')
  prose.textContent = '这是一个关于重构计算税费算法的重要说明。'
  row.appendChild(prose)
  doc.body.appendChild(row)

  // 2. Simulate sidechat composer input in sidebar
  const sideTextarea = doc.createElement('textarea')
  sideTextarea.className = '_4BEzFa_sidechatComposerInput'
  doc.body.appendChild(sideTextarea)

  const fakeWindow = {
    document: doc,
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: (fn) => 0,
    __ModuleLoader__: {
      load(descriptor) {
        fakeWindow.__loaded = descriptor.factory(() => ({}))
      }
    }
  }

  const mod = loadBundle(fakeWindow)
  const { showSelectionBar, dismissSelectionBar } = mod.__testing

  const mockRange = {
    getBoundingClientRect: () => ({ left: 200, top: 150, width: 80, height: 20, bottom: 170 })
  }

  // Pop toolbar
  showSelectionBar(mockRange, '重构计算税费算法', prose)

  const toolbar = doc.querySelector('.dsh-selection-toolbar')
  if (!toolbar) {
    console.error('FAIL  selection toolbar was not mounted')
    process.exit(1)
  }
  console.log('ok    BTW-style selection toolbar mounted with pill shape')

  const addBtn = toolbar.querySelector('.dsh-selection-btn-add')
  const sideBtn = toolbar.querySelector('.dsh-selection-btn-side')
  if (!addBtn || !sideBtn) {
    console.error('FAIL  selection buttons missing in toolbar')
    process.exit(1)
  }
  console.log('ok    toolbar contains both [添加到对话] and [侧边对话] buttons')

  // Click Side Chat (Scheme B): payload should be written into sideTextarea
  sideBtn.dispatch('click')

  if (!sideTextarea.value || !sideTextarea.value.includes('重构计算税费算法')) {
    console.error('FAIL  side chat button did not write quote to sideTextarea, got:', sideTextarea.value)
    process.exit(1)
  }
  if (!sideTextarea.value.includes('第 16 轮')) {
    console.error('FAIL  side chat payload missing turn 16 marker, got:', sideTextarea.value)
    process.exit(1)
  }
  console.log('ok    clicking [侧边对话] wrote clean fenced quote with turn 16 to sidechat input')

  // Toolbar dismissed after click
  if (doc.querySelector('.dsh-selection-toolbar') !== null) {
    console.error('FAIL  toolbar was not dismissed after action click')
    process.exit(1)
  }
  console.log('ok    toolbar dismissed cleanly after action')
}

console.log('\nall checks passed')
