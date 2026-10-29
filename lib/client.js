/*
 * dsh-code-block-quote — client half.
 *
 * Adds a 「引用」 button beside 「复制」 on every fenced code block in a reply.
 * One click puts the whole block into the composer as an inline quote chip; the
 * chip's model form is a fenced blockquote, so the reader can type their
 * question after it and send.
 *
 * Two host contracts carry this:
 *
 *   1. The code-block banner — `data-code-block-banner` inside the rendered
 *      `md-code-block`, whose last action div holds the native copy button.
 *      A MutationObserver seats our button there and re-seats it after any
 *      re-render (the transcript is virtualized, so blocks come and go).
 *
 *   2. `inputTriggers` — the reference-source registry. A chip is an atomic
 *      Lexical node; at send time the host routes each chip back to its owner's
 *      codec for the model form, and a chip without a live owner fails the
 *      send. So the source is registered before the first chip, and its codec is
 *      stateless.
 *
 * Client half only: the host half is a no-op.
 */
window.__ModuleLoader__.load({
	id: "dsh-code-block-quote",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/* ------------------------------------------------------------------ *
		 * Constants
		 * ------------------------------------------------------------------ */

		/** Marks the button we seat, so re-scans never stack duplicates. */
		var ATTR_BUTTON = "data-dsh-code-quote";
		/** Banner seat inside the host's rendered code block. */
		var BANNER = "[data-code-block-banner]";
		var BLOCK = ".md-code-block, [data-code-block-content]";
		var CONTENT = "[data-conversation-content]";
		var COMPOSER = "[data-composer-input]";

		/** The reference source name this plugin owns. */
		var SOURCE_NAME = "code-quote";
		/** Hidden trigger: the source exists for its codec, not for a menu. */
		var TRIGGER = "#";

		/** Marks of DSH's quote wire form (shared with dsh-client-ui-quote). */
		var QUOTE_MARK = "\u275D";
		var COMMENT_MARK = "\u275E";
		var REPLY_MARK = "\u203B";

		var styleTag = null;
		var observer = null;
		var scanning = false;
		var pluginCtx = null;
		var sourceRegistered = false;
		var sourceDisposer = null;
		var holders = 0;

		/* ------------------------------------------------------------------ *
		 * Copy (bilingual; no locale service dependency)
		 * ------------------------------------------------------------------ */

		function zh() {
			try {
				var lang = String(window.document.documentElement.lang || navigator.language || "").toLowerCase();
				return lang.indexOf("zh") === 0;
			} catch (error) {
				return false;
			}
		}

		function t(key) {
			var table = {
				button: ["引用", "Quote"],
				buttonTitle: ["将整段代码作为引用插入输入框", "Quote this whole code block into the composer"],
				quoted: ["已引用", "Quoted"],
				failed: ["插入引用失败", "Could not insert the quote"],
				copied: ["无法插入，已复制", "Insert failed; copied instead"],
				lines: ["{n} 行", "{n} lines"],
				expand: ["展开 ▼", "Expand ▼"],
				collapse: ["收起 ▲", "Collapse ▲"],
				quoteCard: ["代码引用", "Quoted Code"]
			};
			var pair = table[key];
			if (pair === undefined) return key;
			return zh() ? pair[0] : pair[1];
		}

		/* ------------------------------------------------------------------ *
		 * The wire form: a code quote block
		 * ------------------------------------------------------------------ */

		/** Drop trailing spaces and the blank lines a fence should not carry. */
		function blockLines(text) {
			if (typeof text !== "string" || text.trim() === "") return [];
			var lines = text.split(/\r?\n/).map(function (line) {
				return line.replace(/\s+$/, "");
			});
			while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
			while (lines.length > 0 && lines[0].trim() === "") lines.shift();
			return lines;
		}

		/** A language tag is only kept when it is a plain word the fence accepts. */
		function sanitizeLang(value) {
			var lang = String(value === null || value === undefined ? "" : value).trim();
			if (lang === "" || lang.length > 24 || /^[\w+#.-]+$/u.test(lang) === false) return null;
			return lang;
		}

		/**
		 * Escape a body line that would otherwise read back as wire syntax.
		 *
		 * `❝` is deliberately NOT escaped here. The reader collects a block's body
		 * by consuming every consecutive line that starts with `>`, so a body line
		 * beginning with the quote mark stays body — it can never open a second
		 * block. The reader's `unescapeBodyLine` only drops a backslash before
		 * `\`, `❞` and `※`, so escaping `❝` here would leave a stray backslash in
		 * the capsule: corruption, not safety.
		 */
		function escapeBodyLine(line) {
			var match = /^(\s*)([\\\u275E\u203B])/u.exec(line);
			if (match === null) return line;
			return match[1] + "\\" + line.slice(match[1].length);
		}

		/**
		 * The model form of one code quote: a blockquote holding a fenced block,
		 * the `❝` mark opening it so a capsule renderer can recognise the run.
		 * `~~~` is the fence when the code itself contains ` ``` `.
		 */
		function quoteBlock(code, lang) {
			var lines = blockLines(code);
			if (lines.length === 0) return "";
			var fence = lines.some(function (line) {
				return /^\s*```/u.test(line);
			}) ? "~~~" : "```";
			var info = sanitizeLang(lang) ?? "";
			var block = ["> " + QUOTE_MARK + " " + fence + (info === "" ? "" : " " + info)];
			for (var index = 0; index < lines.length; index += 1) {
				var line = lines[index];
				block.push(line.trim() === "" ? ">" : "> " + escapeBodyLine(line));
			}
			block.push("> " + fence);
			return block.join("\n");
		}

		/** The chip label: the language and the line count, clipped. */
		function chipLabel(code, lang) {
			var count = blockLines(code).length;
			var lines = t("lines").replace("{n}", String(count));
			var info = sanitizeLang(lang);
			return info === null ? lines : info + " · " + lines;
		}

		/* ------------------------------------------------------------------ *
		 * The reference source (codec only)
		 * ------------------------------------------------------------------ */

		var quoteSource = {
			trigger: TRIGGER,
			name: SOURCE_NAME,
			showGroupTitle: false,
			candidates: function () {
				return [];
			},
			codec: {
				clipboardText: function (ref) {
					return ref;
				},
				serialize: function (ref) {
					return Promise.resolve(String(ref));
				}
			}
		};

		function ensureSource() {
			if (sourceRegistered) return true;
			if (pluginCtx === null) return false;
			var service = null;
			try {
				service = pluginCtx.get("inputTriggers");
			} catch (error) {
				service = null;
			}
			if (service === null || service === undefined || typeof service.registerSource !== "function") return false;
			try {
				var disposer = service.registerSource(quoteSource);
				sourceDisposer = typeof disposer === "function" ? disposer : null;
				sourceRegistered = true;
				return true;
			} catch (error) {
				// A second mount may have registered it: the codec is stateless, so
				// the resident registration is good enough.
				console.warn("[dsh-code-block-quote] reference source already registered; reusing it:", error);
				sourceRegistered = true;
				sourceDisposer = null;
				return true;
			}
		}

		function releaseSource() {
			if (holders > 0) return;
			sourceRegistered = false;
			var disposer = sourceDisposer;
			sourceDisposer = null;
			if (disposer === null) return;
			try {
				disposer();
			} catch (error) {
				// A host that already forgot the registration is not our problem.
			}
		}

		/* ------------------------------------------------------------------ *
		 * Reading a rendered code block
		 * ------------------------------------------------------------------ */

		/**
		 * The `.md-code-block` root that owns one banner.
		 *
		 * In the shipped renderer the shape is
		 * `block > bannerWrap > banner[data-code-block-banner]`, so the root is
		 * two hops up. One hop is kept as a fallback for a host that seats the
		 * banner directly in the block.
		 */
		function blockOf(banner) {
			if (banner === null || banner === undefined) return null;
			var wrap = banner.parentElement;
			if (wrap === null) return null;
			return wrap.parentElement ?? wrap;
		}

		/** The language tag the banner shows, or null for an untagged block. */
		function languageOf(block) {
			var banner = block.querySelector(BANNER);
			if (banner === null) return null;
			var info = banner.querySelector("div");
			if (info === null) return null;
			var text = String(info.textContent ?? "").trim();
			if (text === "") return null;
			var first = text.split(/[\s,;]+/)[0];
			return first === "" ? null : first;
		}

		/**
		 * The block's source text. The native copy button reads the same node, so
		 * this is exactly what a user would have copied; line numbers live in CSS
		 * counters and never reach `textContent`.
		 */
		function codeOf(block) {
			var pre = block.querySelector("pre");
			var text = pre === null ? "" : String(pre.textContent ?? "");
			return text.replace(/\n+$/, "");
		}

		/** The session the block belongs to, from the transcript's own anchor. */
		function sessionOf(element) {
			var node = element;
			while (node !== null && node !== undefined) {
				if (typeof node.getAttribute === "function") {
					var id = node.getAttribute("data-conversation-session");
					if (typeof id === "string" && id !== "") return id;
				}
				node = node.parentElement;
			}
			return null;
		}

		/* ------------------------------------------------------------------ *
		 * Placing the chip in the composer
		 * ------------------------------------------------------------------ */

		/** The host's resident composer shell for one session, or null. */
		function shellFor(sessionId) {
			if (pluginCtx === null || typeof sessionId !== "string" || sessionId === "") return null;
			var hub = null;
			try {
				var conversation = pluginCtx.get("conversation");
				hub = conversation === null || conversation === undefined ? null : conversation.input;
			} catch (error) {
				hub = null;
			}
			if (hub === null || hub === undefined || typeof hub.shell !== "function") return null;
			try {
				var shell = hub.shell(sessionId);
				return shell === null || shell === undefined ? null : shell;
			} catch (error) {
				return null;
			}
		}

		/** Put the caret at the end of the composer's draft. */
		function focusComposer() {
			try {
				var card = window.document.querySelector(COMPOSER);
				if (card === null) return;
				var editable = card.querySelector('[contenteditable="true"]') ?? card.querySelector("[data-lexical-editor]") ?? card;
				if (typeof editable.focus === "function") editable.focus();
			} catch (error) {
				// Focus is a courtesy; the chip is already in the draft.
			}
		}

		function toast(message) {
			try {
				var node = window.document.createElement("div");
				node.textContent = message;
				node.setAttribute("data-dsh-code-quote-toast", "1");
				node.style.cssText = [
					"position:fixed", "left:50%", "bottom:96px", "transform:translateX(-50%)",
					"z-index:2147483000", "padding:8px 14px", "border-radius:999px",
					"font-size:13px", "line-height:18px", "pointer-events:none",
					"background:rgba(28,28,32,.92)", "color:#fff",
					"box-shadow:0 6px 20px rgba(0,0,0,.24)", "transition:opacity .18s ease"
				].join(";");
				window.document.body.appendChild(node);
				window.setTimeout(function () {
					node.style.opacity = "0";
					window.setTimeout(function () {
						node.remove();
					}, 220);
				}, 1400);
			} catch (error) {
				// A toast that cannot render is not worth a failure path.
			}
		}

		function copyToClipboard(text) {
			try {
				if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === "function") {
					navigator.clipboard.writeText(text);
					return true;
				}
			} catch (error) {
				// Fall through: the caller only uses this as a last resort.
			}
			return false;
		}

		/**
		 * Insert one code quote as a chip. Returns false when the host refuses, so
		 * the caller can fall back to plain text rather than lose the click.
		 */
		function insertQuote(sessionId, code, lang) {
			if (!ensureSource()) return false;
			var model = "\n" + quoteBlock(code, lang) + "\n\n";
			if (model.trim() === "") return false;
			var shell = shellFor(sessionId);
			if (shell === null || typeof shell.insertReference !== "function") return false;
			var actions = shell.actions;
			if (actions === null || actions === undefined || typeof actions.captureInsertion !== "function") return false;
			var captured = actions.captureInsertion();
			if (captured === null || captured === undefined) return false;
			var attachment = {
				source: SOURCE_NAME,
				ref: model,
				label: chipLabel(code, lang),
				appearance: "session",
				clipboardText: model
			};
			try {
				if (shell.insertReference(attachment, captured) === true) {
					focusComposer();
					return true;
				}
			} catch (error) {
				console.warn("[dsh-code-block-quote] insertReference refused the chip:", error);
			}
			return false;
		}

		/** The Markdown fallback: write the quote into the draft as plain text. */
		function insertPayload(sessionId, code, lang) {
			var shell = shellFor(sessionId);
			if (shell === null) return false;
			var actions = shell.actions;
			if (actions === null || actions === undefined || typeof actions.insertText !== "function") return false;
			if (typeof actions.captureInsertion !== "function") return false;
			var payload = "\n" + quoteBlock(code, lang) + "\n\n";
			try {
				if (actions.insertText(payload, actions.captureInsertion()) === true) {
					focusComposer();
					return true;
				}
			} catch (error) {
				console.warn("[dsh-code-block-quote] insertText refused the payload:", error);
			}
			return false;
		}

		/* ------------------------------------------------------------------ *
		 * User bubble quote folding & metadata stripping (方案 B)
		 * ------------------------------------------------------------------ */

		var ATTR_CARD_ENHANCED = "data-dsh-quote-card";
		var ATTR_HANDLED = "data-dsh-quote-handled";

		/**
		 * Clean transport metadata and leftover raw markers from quoted text.
		 * Strips:
		 *   - lines like: ※ 引自第 16 轮
		 *   - lines like: │q1:eyJ2Ijox... or | q1:eyJ2Ijox...
		 *   - inline combinations like: ※ 引自第 16 轮 │q1:...
		 *   - prompt wrappers: # 划选引用与上下文...
		 */
		function cleanQuoteText(raw) {
			var text = String(raw || "");
			text = text.replace(/^\s*※\s*引自[^\n]*$/gmu, "");
			text = text.replace(/^\s*[|│]?\s*q1:[A-Za-z0-9_-]+\s*$/gmu, "");
			text = text.replace(/^\s*※[^\n]*?[|│]\s*q1:[A-Za-z0-9_-]+\s*$/gmu, "");
			text = text.replace(/^\s*#\s*划选引用与上下文[^\n]*/gmu, "");
			text = text.replace(/^\s*注意：以下引文是用户从上文中选取的参考片段[^\n]*/gmu, "");
			text = text.replace(/^\s*---\s*\n##\s*用户需求与指示[^\n]*/gmu, "");
			text = text.replace(/^>\s?/gmu, "");
			return text.replace(/\n{3,}/g, "\n\n").trim();
		}

		/**
		 * Detect language or info from the first line if it looks like a tag or fence.
		 */
		function parseQuoteHeader(cleaned) {
			var lines = cleaned.split("\n");
			var first = (lines[0] || "").trim();
			var lang = "";
			var fenceMatch = /^(?:[“❝]\s*)?(?:```+|~~~+)\s*(\w+)?/u.exec(first);
			if (fenceMatch) {
				lang = fenceMatch[1] || "";
				lines.shift();
				if (lines.length > 0 && /^(?:```+|~~~+)[”❞]?\s*$/u.test(lines[lines.length - 1].trim())) {
					lines.pop();
				}
			} else if (/^[a-zA-Z0-9_+#.-]{1,16}$/.test(first) && lines.length > 1) {
				lang = first;
				lines.shift();
			}
			var body = lines.join("\n").trim();
			var count = body ? body.split("\n").length : 0;
			return {
				lang: lang,
				count: count,
				body: body
			};
		}

		/**
		 * Create a clean, collapsible quote card.
		 */
		function createFoldCard(rawText, doc) {
			var document = doc || window.document;
			var cleaned = cleanQuoteText(rawText);
			if (cleaned === "") return null;

			var parsed = parseQuoteHeader(cleaned);
			var isLong = parsed.count > 3 || cleaned.length > 140;

			var card = document.createElement("div");
			card.className = "dsh-quote-card";
			card.setAttribute(ATTR_CARD_ENHANCED, "1");
			if (isLong) card.setAttribute("data-folded", "true");

			var header = document.createElement("div");
			header.className = "dsh-quote-card-header";

			var titleBox = document.createElement("div");
			titleBox.className = "dsh-quote-card-title";
			var countStr = parsed.count > 0 ? t("lines").replace("{n}", String(parsed.count)) : t("quoteCard");
			titleBox.innerHTML = '<span class="dsh-quote-card-icon">❝</span><span class="dsh-quote-card-label">' +
				(parsed.lang ? parsed.lang + " · " : "") + countStr +
				'</span>';
			header.appendChild(titleBox);

			if (isLong) {
				var toggle = document.createElement("button");
				toggle.type = "button";
				toggle.className = "dsh-quote-card-toggle";
				toggle.textContent = t("expand");
				toggle.addEventListener("click", function (e) {
					e.preventDefault();
					e.stopPropagation();
					var folded = card.getAttribute("data-folded") === "true";
					if (folded) {
						card.setAttribute("data-folded", "false");
						toggle.textContent = t("collapse");
					} else {
						card.setAttribute("data-folded", "true");
						toggle.textContent = t("expand");
					}
				});
				header.appendChild(toggle);
			}

			var body = document.createElement("div");
			body.className = "dsh-quote-card-body";

			var pre = document.createElement("pre");
			var code = document.createElement("code");
			code.textContent = parsed.body || cleaned;
			pre.appendChild(code);
			body.appendChild(pre);

			card.appendChild(header);
			card.appendChild(body);
			return card;
		}

		/**
		 * Scan and enhance user message bubbles:
		 * 1. Targets .btw-official-quote-node / [data-quote-preview] generated by dsh-btw.
		 * 2. Hides the raw base64 coordinate line and replaces it with a clean fold card.
		 */
		function enhanceUserBubbles() {
			if (typeof window === "undefined" || window.document === undefined) return;
			try {
				var btwNodes = window.document.querySelectorAll(".btw-official-quote-node, [data-quote-preview]");
				for (var i = 0; i < btwNodes.length; i += 1) {
					var node = btwNodes[i];
					if (node.getAttribute?.(ATTR_HANDLED) === "1") continue;
					var textEl = node.querySelector?.("[data-quote-preview-text]") ?? node;
					var raw = textEl.textContent || node.getAttribute?.("title") || "";
					if (!raw.trim()) continue;
					var card = createFoldCard(raw, window.document);
					if (card !== null && node.parentElement !== null) {
						node.setAttribute(ATTR_HANDLED, "1");
						node.style.display = "none";
						node.parentElement.insertBefore(card, node);
					}
				}
			} catch (error) {
				console.error("[dsh-code-block-quote] enhanceUserBubbles failed:", error);
			}
		}

		/* ------------------------------------------------------------------ *
		 * Button injection
		 * ------------------------------------------------------------------ */

		function pressButton(block, button) {
			var code = codeOf(block);
			if (code.trim() === "") return;
			var lang = languageOf(block);
			var sessionId = sessionOf(block);
			var done = insertQuote(sessionId, code, lang) || insertPayload(sessionId, code, lang);
			if (!done && copyToClipboard(code)) {
				toast(t("copied"));
				return;
			}
			if (!done) {
				toast(t("failed"));
				return;
			}
			var original = button.textContent;
			button.textContent = t("quoted");
			button.setAttribute("data-quoted", "1");
			window.setTimeout(function () {
				button.textContent = original;
				button.removeAttribute("data-quoted");
			}, 1000);
		}

		/** Seat one button in a block's banner, unless it already has one. */
		function injectButton(block) {
			var banner = block.querySelector(BANNER);
			if (banner === null) return;
			if (banner.querySelector("[" + ATTR_BUTTON + "]") !== null) return;
			// The banner's own structure is [heading, actions]: the last element
			// child is the action row that already holds the native copy button.
			var seat = banner.lastElementChild ?? banner;

			var button = window.document.createElement("button");
			button.type = "button";
			button.className = "dsh-code-quote-btn";
			button.setAttribute(ATTR_BUTTON, "1");
			button.setAttribute("aria-label", t("buttonTitle"));
			button.title = t("buttonTitle");
			button.textContent = t("button");
			button.addEventListener("mousedown", function (event) {
				// Keep the transcript selection (if any) from collapsing before the
				// click handler reads the block.
				event.preventDefault();
			});
			button.addEventListener("click", function (event) {
				event.preventDefault();
				event.stopPropagation();
				pressButton(block, button);
			});
			seat.appendChild(button);
		}

		/** Seat buttons in every banner and enhance user bubbles in the document. */
		function scan() {
			if (scanning) return;
			scanning = true;
			try {
				var banners = window.document.querySelectorAll(BANNER);
				for (var index = 0; index < banners.length; index += 1) {
					var block = blockOf(banners[index]);
					if (block !== null) injectButton(block);
				}
				enhanceUserBubbles();
			} catch (error) {
				console.error("[dsh-code-block-quote] scan failed:", error);
			} finally {
				scanning = false;
			}
		}

		function startScanning() {
			if (typeof window.MutationObserver !== "function") {
				scan();
				return;
			}
			observer = new window.MutationObserver(function (records) {
				for (var index = 0; index < records.length; index += 1) {
					var record = records[index];
					// Ignore mutations inside our own quote cards
					if (record.target && record.target.closest?.("[" + ATTR_CARD_ENHANCED + "]")) continue;

					var added = record.addedNodes;
					for (var at = 0; at < added.length; at += 1) {
						var node = added[at];
						if (node === null || node.nodeType !== 1) continue;
						if (node.matches?.(BANNER) === true || node.querySelector?.(BANNER) !== null ||
							node.matches?.(".btw-official-quote-node, [data-quote-preview]") === true ||
							node.querySelector?.(".btw-official-quote-node, [data-quote-preview]") !== null) {
							scan();
							return;
						}
					}
					if (record.type === "childList" && record.target !== null && record.target.nodeType === 1) {
						if (record.target.matches?.(BANNER) === true || record.target.closest?.(BANNER) !== null ||
							record.target.matches?.(".btw-official-quote-node, [data-quote-preview]") === true ||
							record.target.closest?.(".btw-official-quote-node, [data-quote-preview]") !== null) {
							scan();
							return;
						}
					}
				}
			});
			observer.observe(window.document.body, { childList: true, subtree: true });
			scan();
		}

		function stopScanning() {
			if (observer !== null) {
				try {
					observer.disconnect();
				} catch (error) {
					// Already gone.
				}
				observer = null;
			}
			var seated = window.document.querySelectorAll("[" + ATTR_BUTTON + "]");
			for (var index = 0; index < seated.length; index += 1) seated[index].remove();

			var cards = window.document.querySelectorAll("[" + ATTR_CARD_ENHANCED + "]");
			for (var c = 0; c < cards.length; c += 1) cards[c].remove();

			var handled = window.document.querySelectorAll("[" + ATTR_HANDLED + "]");
			for (var h = 0; h < handled.length; h += 1) {
				handled[h].removeAttribute(ATTR_HANDLED);
				if (typeof handled[h].style?.removeProperty === "function") {
					handled[h].style.removeProperty("display");
				} else if (handled[h].style) {
					handled[h].style.display = "";
				}
			}
		}

		/* ------------------------------------------------------------------ *
		 * Styles
		 * ------------------------------------------------------------------ */

		var CSS = [
			".dsh-code-quote-btn{",
			"display:inline-flex;align-items:center;justify-content:center;",
			"min-width:0;height:22px;padding:0 8px;margin:0 2px 0 0;",
			"border:0;border-radius:6px;background:transparent;",
			"font-family:inherit;font-size:12px;line-height:22px;",
			"color:var(--dsw-alias-label-secondary,#6b6b72);",
			"cursor:pointer;white-space:nowrap;",
			"transition:background-color .12s ease,color .12s ease;",
			"}",
			".dsh-code-quote-btn:hover{",
			"background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));",
			"color:var(--dsw-alias-label-primary,#1c1c20);",
			"}",
			".dsh-code-quote-btn:active{transform:translateY(.5px);}",
			".dsh-code-quote-btn[data-quoted=\"1\"]{",
			"color:var(--dsw-alias-state-business-primary,#4d6bfe);",
			"}",
			/* Collapsible Quote Card (方案 B) */
			".dsh-quote-card{",
			"display:block;margin:6px 0 8px 0;border-radius:8px;",
			"border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));",
			"background:var(--dsw-alias-bg-hover,rgba(127,127,127,.06));",
			"overflow:hidden;box-sizing:border-box;max-width:100%;",
			"transition:border-color .15s ease;",
			"}",
			".dsh-quote-card:hover{border-color:var(--dsw-alias-border-l1,rgba(127,127,127,.35));}",
			".dsh-quote-card-header{",
			"display:flex;align-items:center;justify-content:space-between;",
			"padding:5px 10px;background:var(--dsw-alias-bg-subtle,rgba(127,127,127,.04));",
			"border-bottom:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.12));",
			"user-select:none;",
			"}",
			".dsh-quote-card-title{",
			"display:flex;align-items:center;gap:6px;font-size:12px;",
			"color:var(--dsw-alias-label-secondary,#8a8a93);",
			"}",
			".dsh-quote-card-icon{font-size:13px;color:var(--dsw-alias-state-business-primary,#4d6bfe);}",
			".dsh-quote-card-label{font-weight:500;}",
			".dsh-quote-card-toggle{",
			"border:0;background:transparent;color:var(--dsw-alias-state-business-primary,#4d6bfe);",
			"font-size:11.5px;cursor:pointer;padding:2px 6px;border-radius:4px;",
			"transition:background-color .12s ease;",
			"}",
			".dsh-quote-card-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));}",
			".dsh-quote-card-body{position:relative;overflow:hidden;}",
			".dsh-quote-card[data-folded=\"true\"] .dsh-quote-card-body{max-height:76px;}",
			".dsh-quote-card[data-folded=\"true\"] .dsh-quote-card-body::after{",
			"content:\"\";position:absolute;left:0;right:0;bottom:0;height:36px;",
			"background:linear-gradient(to bottom,transparent,var(--dsw-alias-turn-user-bg,var(--dsw-alias-bg-base,#1e1e24)));",
			"pointer-events:none;",
			"}",
			".dsh-quote-card-body pre{",
			"margin:0;padding:8px 10px;",
			"font-family:ui-monospace,\"Cascadia Code\",SFMono-Regular,Menlo,Monaco,Consolas,monospace;",
			"font-size:12.5px;line-height:1.55;",
			"color:var(--dsw-alias-label-primary,#e4e4e7);",
			"white-space:pre-wrap;word-break:break-word;background:transparent;",
			"}"
		].join("");

		function insertStyles() {
			if (window.document === undefined) return function () {};
			var tag = window.document.querySelector('style[data-plugin-css="dsh-code-block-quote"]');
			if (tag === null) {
				tag = window.document.createElement("style");
				tag.setAttribute("data-plugin", "dsh-code-block-quote");
				tag.setAttribute("data-plugin-css", "dsh-code-block-quote");
				window.document.head.appendChild(tag);
			}
			tag.textContent = CSS;
			styleTag = tag;
			return function () {
				try {
					tag.remove();
				} catch (error) {
					// Already detached.
				}
				if (styleTag === tag) styleTag = null;
			};
		}

		/* ------------------------------------------------------------------ *
		 * Plugin entry
		 * ------------------------------------------------------------------ */

		function apply(ctx) {
			if (typeof window === "undefined" || window.document === undefined) return;
			pluginCtx = ctx;
			var disposeStyles = null;
			try {
				disposeStyles = insertStyles();

				// The source must exist before the first chip, and it rides its own
				// host effect so a missing inputTriggers service degrades to the
				// plain-text fallback instead of taking the plugin down.
				var installSource = function (hostCtx) {
					return hostCtx.effect(function () {
						holders += 1;
						ensureSource();
						return function () {
							holders = Math.max(0, holders - 1);
							releaseSource();
						};
					}, "dsh-code-block-quote: reference source");
				};
				if (typeof ctx.inject === "function") ctx.inject(["inputTriggers"], installSource);
				else installSource(ctx);

				startScanning();
			} catch (error) {
				console.error("[dsh-code-block-quote] apply failed", error);
				try {
					stopScanning();
				} catch (cleanupError) {
					console.error("[dsh-code-block-quote] cleanup after a failed apply also failed", cleanupError);
				}
				if (typeof disposeStyles === "function") {
					try {
						disposeStyles();
					} catch (styleError) {
						// Already gone.
					}
				}
				return;
			}

			ctx.effect(function () {
				return function () {
					if (typeof disposeStyles === "function") disposeStyles();
					stopScanning();
					pluginCtx = null;
				};
			}, "dsh-code-block-quote: dom teardown");
		}

		exports.apply = apply;
		/** No hard service dependency: every lookup goes through `ctx.get`. */
		exports.inject = [];
		exports.name = "dsh-code-block-quote";

		/** Pure helpers, for the offline check in scripts/check-client.mjs. */
		exports.__testing = {
			blockLines: blockLines,
			sanitizeLang: sanitizeLang,
			escapeBodyLine: escapeBodyLine,
			quoteBlock: quoteBlock,
			chipLabel: chipLabel,
			cleanQuoteText: cleanQuoteText,
			parseQuoteHeader: parseQuoteHeader,
			createFoldCard: createFoldCard
		};

		return module.exports;
	}
});
