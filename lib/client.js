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
				quoteCard: ["代码引用", "Quoted Code"],
				textQuoteCard: ["文本引用", "Quoted Text"],
				turn: ["第 {n} 轮", "Turn {n}"],
				jump: ["📍 定位", "📍 Jump"],
				jumpTitle: ["平滑定位到上文对应位置并高亮", "Scroll to source and highlight"],
				jumpFailed: ["未找到对应的历史消息", "Source message not found in view"],
				addToChat: ["💬 添加到对话", "💬 Add to Chat"],
				sideChat: ["📑 侧边对话", "📑 Side Chat"],
				sideChatUnavailable: ["未检测到侧边栏扩展", "Sidebar extension unavailable"]
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
		 * The model form of one quote:
		 * - When `meta && meta.isCode === false`, emits a clean prose blockquote (`> ❝ line1\n> line2`)
		 *   without code fences.
		 * - Otherwise (default / code blocks), emits a fenced blockquote (`> ❝ ``` lang\n...\n> ``` `).
		 * `~~~` is the fence when the code itself contains ` ``` `.
		 */
		function quoteBlock(code, lang, meta) {
			var lines = blockLines(code);
			if (lines.length === 0) return "";
			var isCode = !(meta && meta.isCode === false);
			var block = [];
			if (isCode) {
				var fence = lines.some(function (line) {
					return /^\s*```/u.test(line);
				}) ? "~~~" : "```";
				var info = sanitizeLang(lang) ?? "";
				block.push("> " + QUOTE_MARK + " " + fence + (info === "" ? "" : " " + info));
				for (var index = 0; index < lines.length; index += 1) {
					var line = lines[index];
					block.push(line.trim() === "" ? ">" : "> " + escapeBodyLine(line));
				}
				block.push("> " + fence);
			} else {
				for (var pIdx = 0; pIdx < lines.length; pIdx += 1) {
					var pLine = lines[pIdx];
					if (pIdx === 0) {
						block.push(pLine.trim() === "" ? "> " + QUOTE_MARK : "> " + QUOTE_MARK + " " + escapeBodyLine(pLine));
					} else {
						block.push(pLine.trim() === "" ? ">" : "> " + escapeBodyLine(pLine));
					}
				}
			}
			if (meta && meta.turn) {
				block.push("> " + REPLY_MARK + " 第 " + meta.turn + " 轮");
			}
			return block.join("\n");
		}

		/** The chip label: the language (or first line snippet for prose), line count, and optional turn. */
		function chipLabel(code, lang, meta) {
			var bLines = blockLines(code);
			var count = bLines.length;
			var lines = t("lines").replace("{n}", String(count));
			var isCode = !(meta && meta.isCode === false);
			var info = isCode ? sanitizeLang(lang) : null;
			var label = "";
			if (!isCode && bLines.length > 0) {
				var firstLine = bLines[0].trim();
				var snippet = firstLine.length > 16 ? firstLine.slice(0, 15) + "…" : firstLine;
				label = count > 1 ? snippet + " · " + lines : snippet;
			} else {
				label = info === null ? lines : info + " · " + lines;
			}
			if (meta && meta.turn) {
				label += " · " + t("turn").replace("{n}", String(meta.turn));
			}
			return label;
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

		/** The turn number the block belongs to, if a parent row carries one. */
		function turnOf(element) {
			var node = element;
			while (node !== null && node !== undefined) {
				if (typeof node.getAttribute === "function") {
					var turn = node.getAttribute("data-chat-turn");
					if (typeof turn === "string" && turn !== "") return turn;
				}
				node = node.parentElement;
			}
			return "";
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
		function insertQuote(sessionId, code, lang, meta) {
			if (!ensureSource()) return false;
			var model = "\n" + quoteBlock(code, lang, meta) + "\n\n";
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
				label: chipLabel(code, lang, meta),
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
		function insertPayload(sessionId, code, lang, meta) {
			var shell = shellFor(sessionId);
			if (shell === null) return false;
			var actions = shell.actions;
			if (actions === null || actions === undefined || typeof actions.insertText !== "function") return false;
			if (typeof actions.captureInsertion !== "function") return false;
			var payload = "\n" + quoteBlock(code, lang, meta) + "\n\n";
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
		 * Extract turn number if raw text carries a turn marker (e.g. ※ 第 16 轮 or ※ 引自第 16 轮).
		 */
		function extractQuoteTurn(raw) {
			var match = /※\s*(?:引自)?\s*第\s*(\d+)\s*轮/u.exec(String(raw || ""));
			return match ? match[1] : "";
		}

		/**
		 * Extract the first non-empty code line as a search fingerprint for precise jump targeting.
		 */
		function codeFingerprintOf(body) {
			var lines = String(body || "").split(/\r?\n/);
			for (var i = 0; i < lines.length; i += 1) {
				var trimmed = lines[i].trim();
				if (trimmed.length > 2 && !/^(?:```+|~~~+|[“❝”❞>#])/u.test(trimmed)) {
					return trimmed.slice(0, 80);
				}
			}
			return "";
		}

		/**
		 * Clean transport metadata and leftover raw markers from quoted text.
		 * Strips:
		 *   - lines like: ※ 第 16 轮 or ※ 引自第 16 轮
		 *   - lines like: │q1:eyJ2Ijox... or | q1:eyJ2Ijox...
		 *   - inline combinations like: ※ 引自第 16 轮 │q1:...
		 *   - prompt wrappers: # 划选引用与上下文...
		 */
		function cleanQuoteText(raw) {
			var text = String(raw || "");
			text = text.replace(/^\s*※\s*(?:引自)?\s*第\s*\d+\s*轮[^\n]*$/gmu, "");
			text = text.replace(/^\s*[|│]?\s*q1:[A-Za-z0-9_-]+\s*$/gmu, "");
			text = text.replace(/^\s*※[^\n]*?[|│]\s*q1:[A-Za-z0-9_-]+\s*$/gmu, "");
			text = text.replace(/^\s*#\s*划选引用与上下文[^\n]*/gmu, "");
			text = text.replace(/^\s*注意：以下引文是用户从上文中选取的参考片段[^\n]*/gmu, "");
			text = text.replace(/^\s*---\s*\n##\s*用户需求与指示[^\n]*/gmu, "");
			text = text.replace(/^>\s?/gmu, "");
			return text.replace(/\n{3,}/g, "\n\n").trim();
		}

		/**
		 * Jump back to the source message/code block and flash with a gentle breathing highlight.
		 */
		function jumpToSource(turn, fingerprint, cardEl) {
			if (typeof window === "undefined" || window.document === undefined) return false;
			var doc = window.document;
			var target = null;

			// 1. Coarse search: by turn container (a turn can have multiple flow rows)
			if (turn) {
				var rows = doc.querySelectorAll('[data-chat-turn="' + turn + '"]');
				if (rows.length > 0) {
					target = rows[0];
					// 2. Fine search: match fingerprint within that turn's code blocks or prose paragraphs
					if (fingerprint) {
						var matchedInner = null;
						for (var r = 0; r < rows.length; r += 1) {
							var row = rows[r];
							if (cardEl && (cardEl === row || (typeof row.contains === "function" && row.contains(cardEl)))) continue;
							var candidates = row.querySelectorAll(".md-code-block, [data-code-block-content], pre, code, p, li, h1, h2, h3, h4, blockquote");
							for (var i = 0; i < candidates.length; i += 1) {
								var text = candidates[i].textContent || "";
								if (text.indexOf(fingerprint) >= 0) {
									matchedInner = candidates[i].closest?.(".md-code-block") || candidates[i];
									break;
								}
							}
							if (matchedInner !== null) {
								target = matchedInner;
								break;
							}
							if ((row.textContent || "").indexOf(fingerprint) >= 0) {
								target = row;
							}
						}
					}
				}
			}

			// 3. Fallback: search globally for the fingerprint (excluding inside the card itself)
			if (target === null && fingerprint) {
				var allBlocks = doc.querySelectorAll(".md-code-block, [data-code-block-content], p, li, blockquote");
				for (var b = 0; b < allBlocks.length; b += 1) {
					var item = allBlocks[b];
					if (cardEl && (cardEl === item || (typeof cardEl.contains === "function" && cardEl.contains(item)))) continue;
					if ((item.textContent || "").indexOf(fingerprint) >= 0) {
						target = item;
						break;
					}
				}
			}

			if (target === null) {
				toast(t("jumpFailed"));
				return false;
			}

			// 4. Smooth scroll into center view
			try {
				if (typeof target.scrollIntoView === "function") {
					target.scrollIntoView({ behavior: "smooth", block: "center" });
				}
			} catch (scrollErr) {
				try { target.scrollIntoView(); } catch (e) {}
			}

			// 5. Flash highlight
			if (target.classList && typeof target.classList.add === "function") {
				target.classList.remove("dsh-quote-target-flash");
				if (typeof target.offsetWidth === "number") void target.offsetWidth;
				target.classList.add("dsh-quote-target-flash");
				window.setTimeout(function () {
					target.classList.remove("dsh-quote-target-flash");
				}, 1800);
			}

			return true;
		}

		/**
		 * Detect language or info from the first line if it looks like a tag or fence.
		 */
		function parseQuoteHeader(cleaned) {
			var lines = cleaned.split("\n");
			var first = (lines[0] || "").trim();
			var lang = "";
			var isCode = false;
			var fenceMatch = /^(?:[“❝]\s*)?(?:```+|~~~+)\s*([\w+#.-]+)?\s*$/u.exec(first);
			if (fenceMatch) {
				isCode = true;
				lang = fenceMatch[1] || "";
				lines.shift();
				if (lines.length > 0 && /^(?:```+|~~~+)[”❞]?\s*$/u.test(lines[lines.length - 1].trim())) {
					lines.pop();
				}
			} else if (/^[a-zA-Z0-9_+#.-]{1,16}$/.test(first) && lines.length > 1) {
				isCode = true;
				lang = first;
				lines.shift();
			} else if (/^[“❝]\s*/u.test(first)) {
				lines[0] = first.replace(/^[“❝]\s*/u, "");
			}
			var body = lines.join("\n").trim();
			var count = body ? body.split("\n").length : 0;
			return {
				lang: lang,
				isCode: isCode,
				count: count,
				body: body
			};
		}

		/**
		 * Split a plain user message run that contains `> ❝ ...` quote blocks and trailing user text.
		 * Returns an array of `{ type: "quote" | "text", text: string }`, or null if no quote block is present.
		 */
		function splitRawQuoteMessage(raw) {
			var value = String(raw || "");
			if (value.indexOf(QUOTE_MARK) === -1 && !/^\s*>\s*```/mu.test(value)) return null;
			var lines = value.split(/\r?\n/);
			var segments = [];
			var loose = [];
			var i = 0;
			while (i < lines.length) {
				var line = lines[i];
				var isQuoteStart = /^\s*>\s*\u275D/u.test(line) || (/^\s*\u275D/u.test(line) && lines.length > 1);
				if (!isQuoteStart) {
					loose.push(line);
					i += 1;
					continue;
				}
				var before = loose.join("\n").trim();
				if (before !== "") segments.push({ type: "text", text: before });
				loose = [];
				var qLines = [line];
				i += 1;
				while (i < lines.length && (/^\s*>/u.test(lines[i]) || /^\s*※/u.test(lines[i]) || /^\s*[|│]?q1:/u.test(lines[i]))) {
					qLines.push(lines[i]);
					i += 1;
				}
				segments.push({ type: "quote", text: qLines.join("\n") });
			}
			var tail = loose.join("\n").trim();
			if (tail !== "") segments.push({ type: "text", text: tail });
			var hasQuote = segments.some(function (s) { return s.type === "quote"; });
			return hasQuote ? segments : null;
		}

		/**
		 * Create a clean, collapsible quote card with jump button.
		 */
		function createFoldCard(rawText, doc) {
			var document = doc || window.document;
			var turn = extractQuoteTurn(rawText);
			var cleaned = cleanQuoteText(rawText);
			if (cleaned === "") return null;

			var parsed = parseQuoteHeader(cleaned);
			var isLong = parsed.count > 3 || cleaned.length > 140;
			var fingerprint = codeFingerprintOf(parsed.body || cleaned);

			var card = document.createElement("div");
			card.className = "dsh-quote-card";
			card.setAttribute(ATTR_CARD_ENHANCED, "1");
			if (!parsed.isCode) card.setAttribute("data-quote-kind", "prose");
			if (turn) card.setAttribute("data-quote-turn", turn);
			if (isLong) card.setAttribute("data-folded", "true");

			var header = document.createElement("div");
			header.className = "dsh-quote-card-header";

			var titleBox = document.createElement("div");
			titleBox.className = "dsh-quote-card-title";
			var kindLabel = parsed.lang ? parsed.lang : (parsed.isCode ? t("quoteCard") : t("textQuoteCard"));
			var countStr = parsed.count > 0 ? t("lines").replace("{n}", String(parsed.count)) : "";
			var turnLabel = turn ? " · " + t("turn").replace("{n}", turn) : "";

			var iconSpan = document.createElement("span");
			iconSpan.className = "dsh-quote-card-icon";
			iconSpan.textContent = "❝";
			titleBox.appendChild(iconSpan);

			var labelSpan = document.createElement("span");
			labelSpan.className = "dsh-quote-card-label";
			labelSpan.textContent = kindLabel + (countStr ? " · " + countStr : "") + turnLabel;
			titleBox.appendChild(labelSpan);
			header.appendChild(titleBox);

			var actionsBox = document.createElement("div");
			actionsBox.className = "dsh-quote-card-actions";

			var jumpBtn = document.createElement("button");
			jumpBtn.type = "button";
			jumpBtn.className = "dsh-quote-card-jump";
			jumpBtn.setAttribute("aria-label", t("jumpTitle"));
			jumpBtn.title = t("jumpTitle");
			jumpBtn.textContent = t("jump");
			jumpBtn.addEventListener("click", function (e) {
				e.preventDefault();
				e.stopPropagation();
				jumpToSource(turn, fingerprint, card);
			});
			actionsBox.appendChild(jumpBtn);

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
				actionsBox.appendChild(toggle);
			}

			header.appendChild(actionsBox);

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
		 * 2. Also targets native plain-text runs (e.g. span[class*="plainRun"] or bubble children)
		 *    that contain raw `> ❝ ...` quote blocks, splitting them into collapsible quote cards + user text!
		 */
		function enhanceUserBubbles() {
			if (typeof window === "undefined" || window.document === undefined) return;
			try {
				// Path 1: dsh-btw quote nodes
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

				// Path 2: Native plain text runs containing raw `> ❝` quote blocks
				var plainRuns = window.document.querySelectorAll('span[class*="plainRun"], div[class*="bubble"] > span, [data-conversation-content] span');
				for (var p = 0; p < plainRuns.length; p += 1) {
					var run = plainRuns[p];
					if (run.getAttribute?.(ATTR_HANDLED) === "1") continue;
					if (run.closest?.("[" + ATTR_CARD_ENHANCED + "], [data-dshq]")) continue;
					// Only leaf text elements
					if (run.children && run.children.length > 0) continue;
					var runText = run.textContent || "";
					if (runText.indexOf(QUOTE_MARK) === -1) continue;

					var segments = splitRawQuoteMessage(runText);
					if (segments === null) continue;

					var parent = run.parentElement;
					if (parent === null) continue;

					var wrapper = window.document.createElement("div");
					wrapper.className = "dsh-quote-message-wrap";
					wrapper.setAttribute(ATTR_CARD_ENHANCED, "1");

					for (var s = 0; s < segments.length; s += 1) {
						var seg = segments[s];
						if (seg.type === "quote") {
							var segCard = createFoldCard(seg.text, window.document);
							if (segCard !== null) wrapper.appendChild(segCard);
						} else {
							var textDiv = window.document.createElement("div");
							textDiv.className = "dsh-quote-user-text";
							textDiv.textContent = seg.text;
							wrapper.appendChild(textDiv);
						}
					}

					run.setAttribute(ATTR_HANDLED, "1");
					run.style.display = "none";
					parent.insertBefore(wrapper, run);
				}
			} catch (error) {
				console.error("[dsh-code-block-quote] enhanceUserBubbles failed:", error);
			}
		}

		/* ------------------------------------------------------------------ *
		 * Global text selection toolbar (BTW-style pill)
		 * ------------------------------------------------------------------ */

		var activeSelectionBar = null;

		function dismissSelectionBar() {
			if (activeSelectionBar !== null) {
				try {
					if (typeof activeSelectionBar.remove === "function") activeSelectionBar.remove();
				} catch (e) {}
				activeSelectionBar = null;
			}
		}

		/**
		 * Set value on a React-controlled textarea so React's onChange fires properly.
		 */
		function setReactInputValue(input, value) {
			var setter = null;
			try {
				var proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
				var desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
				setter = desc && desc.set ? desc.set : null;
			} catch (e) {}
			if (setter) {
				setter.call(input, value);
			} else {
				input.value = value;
			}
			try {
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
				input.focus();
				input.scrollTop = input.scrollHeight;
			} catch (e) {}
		}

		function findSideChatInput(doc) {
			return doc.querySelector(
				'textarea._4BEzFa_sidechatComposerInput, textarea[class*="sidechatComposerInput"], textarea[class*="sidechat"], [data-sidechat-input], textarea[data-sidechat-composer]'
			);
		}

		/**
		 * Find or open sidechat composer in better-sidebar (supports async tab mount).
		 */
		function openSideChatComposer(payload, sessionId) {
			if (typeof window === "undefined" || window.document === undefined) return Promise.resolve(false);
			var doc = window.document;

			// 1. Try via betterSidebar service first (opens right sidebar & sidechat tab cleanly)
			var openedViaService = false;
			if (pluginCtx !== null) {
				try {
					var bs = pluginCtx.get("betterSidebar");
					if (bs && typeof bs.openTab === "function") {
						var scope = sessionId ? { sessionId: sessionId } : undefined;
						bs.openTab({ type: "sidechat" }, scope);
						openedViaService = true;
					}
				} catch (e) {}
			}

			// 2. Also try DOM buttons if sidebar is collapsed or tab button is visible
			if (!openedViaService) {
				var sidebarToggle = doc.querySelector('button[aria-label*="打开右侧边栏"], button[aria-label*="展开侧边栏"], [data-sidebar-toggle]');
				if (sidebarToggle && typeof sidebarToggle.click === "function") {
					try { sidebarToggle.click(); } catch (e) {}
				}
				var sidechatTab = doc.querySelector('button[aria-label*="侧边对话"], button[title*="侧边对话"], button[title*="Side Chat"], button[aria-label*="Side Chat"]');
				if (sidechatTab && typeof sidechatTab.click === "function") {
					try { sidechatTab.click(); } catch (e) {}
				}
			}

			// 3. Fast path: textarea is already mounted in DOM
			var immediateInput = findSideChatInput(doc);
			if (immediateInput !== null) {
				var oldVal = immediateInput.value || "";
				var nextVal = oldVal.trim() ? oldVal.replace(/\s+$/, "") + "\n\n" + payload + "\n\n" : payload + "\n\n";
				setReactInputValue(immediateInput, nextVal);
				return Promise.resolve(true);
			}

			// 4. Async poll path: wait up to 4 seconds for SideChatView to mount & create thread
			return new Promise(function (resolve) {
				var attempts = 0;
				var maxAttempts = 25;
				var timer = window.setInterval(function () {
					attempts += 1;
					var input = findSideChatInput(doc);
					if (input !== null) {
						window.clearInterval(timer);
						var cur = input.value || "";
						var updated = cur.trim() ? cur.replace(/\s+$/, "") + "\n\n" + payload + "\n\n" : payload + "\n\n";
						setReactInputValue(input, updated);
						resolve(true);
						return;
					}
					// If sidechat shows a "新建侧边对话" primary button in hero state, click it once
					if (attempts === 3) {
						var createBtn = doc.querySelector('button[class*="sidechatPrimaryBtn"]');
						if (createBtn && typeof createBtn.click === "function") {
							try { createBtn.click(); } catch (e) {}
						}
					}
					if (attempts >= maxAttempts) {
						window.clearInterval(timer);
						resolve(false);
					}
				}, 160);
			});
		}

		/**
		 * Fallback for active session id when selection container is outside or unlabelled.
		 */
		function resolveActiveSessionId(element) {
			var id = sessionOf(element);
			if (id) return id;
			if (typeof window === "undefined" || !window.document) return null;
			var activeContent = window.document.querySelector('[data-conversation-content][data-conversation-session], [data-conversation-session]');
			if (activeContent && typeof activeContent.getAttribute === "function") {
				return activeContent.getAttribute("data-conversation-session") || null;
			}
			return null;
		}

		function showSelectionBar(range, text, commonContainer) {
			dismissSelectionBar();
			if (typeof window === "undefined" || window.document === undefined) return;
			var doc = window.document;

			var rect = range.getBoundingClientRect ? range.getBoundingClientRect() : null;
			if (!rect || (rect.width === 0 && rect.height === 0)) return;

			// Suppress competing selection bars (ui-quote / btw) so they don't overlap or steal clicks
			try {
				var competing = doc.querySelectorAll('#dsh-quote-bar, .btw-selection-menu, [data-text-interaction-surface]');
				for (var c = 0; c < competing.length; c += 1) {
					competing[c].style.display = "none";
				}
			} catch (e) {}

			var bar = doc.createElement("div");
			bar.className = "dsh-selection-toolbar";
			bar.setAttribute("role", "toolbar");

			// Determine if selection is inside a code block
			var codeContainer = commonContainer && typeof commonContainer.closest === "function" ? commonContainer.closest("pre, code, .md-code-block") : null;
			var isCode = codeContainer !== null;
			var lang = isCode ? (languageOf(codeContainer.closest?.(".md-code-block") || codeContainer) || "") : "";
			var turn = turnOf(commonContainer);
			var sessionId = resolveActiveSessionId(commonContainer);
			var meta = { isCode: isCode };
			if (turn) meta.turn = turn;

			// Guard bar against document-level mousedown/pointerdown listeners from other plugins
			var stopBarEvent = function (e) {
				e.preventDefault();
				e.stopPropagation();
				if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
			};
			bar.addEventListener("pointerdown", stopBarEvent, true);
			bar.addEventListener("mousedown", stopBarEvent, true);
			bar.addEventListener("mouseup", function (e) {
				e.stopPropagation();
				if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
			}, true);

			var handledAction = false;
			var triggerAdd = function (e) {
				if (handledAction) return;
				handledAction = true;
				e.preventDefault();
				e.stopPropagation();
				if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
				var targetSession = sessionId || resolveActiveSessionId(null);
				var done = insertQuote(targetSession, text, lang, meta) || insertPayload(targetSession, text, lang, meta);
				if (!done && copyToClipboard(quoteBlock(text, lang, meta))) toast(t("copied"));
				else if (!done) toast(t("failed"));
				dismissSelectionBar();
				try { window.getSelection()?.removeAllRanges(); } catch (err) {}
			};

			// 1. Add to chat button
			var addBtn = doc.createElement("button");
			addBtn.type = "button";
			addBtn.className = "dsh-selection-btn dsh-selection-btn-add";
			addBtn.textContent = t("addToChat");
			addBtn.addEventListener("pointerdown", stopBarEvent);
			addBtn.addEventListener("mousedown", triggerAdd);
			addBtn.addEventListener("click", triggerAdd);
			bar.appendChild(addBtn);

			var triggerSide = function (e) {
				if (handledAction) return;
				handledAction = true;
				e.preventDefault();
				e.stopPropagation();
				if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
				var targetSession = sessionId || resolveActiveSessionId(null);
				var payload = quoteBlock(text, lang, meta);
				dismissSelectionBar();
				try { window.getSelection()?.removeAllRanges(); } catch (err) {}
				Promise.resolve(openSideChatComposer(payload, targetSession)).then(function (ok) {
					if (!ok) {
						if (copyToClipboard(payload)) toast(t("sideChatUnavailable") + " · " + t("copied"));
						else toast(t("sideChatUnavailable"));
					}
				});
			};

			// 2. Side chat button (方案 B)
			var sideBtn = doc.createElement("button");
			sideBtn.type = "button";
			sideBtn.className = "dsh-selection-btn dsh-selection-btn-side";
			sideBtn.textContent = t("sideChat");
			sideBtn.addEventListener("pointerdown", stopBarEvent);
			sideBtn.addEventListener("mousedown", triggerSide);
			sideBtn.addEventListener("click", triggerSide);
			bar.appendChild(sideBtn);

			// Position calculation
			doc.body.appendChild(bar);
			var barRect = bar.getBoundingClientRect ? bar.getBoundingClientRect() : { width: 180, height: 32 };
			var x = rect.left + rect.width / 2;
			var y = rect.top - (barRect.height || 32) - 8;
			if (y < 8) y = rect.bottom + 8;

			var halfW = (barRect.width || 180) / 2;
			var winW = window.innerWidth || 1280;
			if (x - halfW < 8) x = 8 + halfW;
			else if (x + halfW > winW - 8) x = winW - 8 - halfW;

			bar.style.left = x + "px";
			bar.style.top = y + "px";
			activeSelectionBar = bar;
		}

		function onSelectionChange(event) {
			if (typeof window === "undefined" || window.document === undefined) return;
			// Never destroy/recreate the toolbar if the mouseup/event happened inside the toolbar itself!
			if (event && event.target && typeof event.target.closest === "function") {
				if (event.target.closest(".dsh-selection-toolbar")) return;
			}
			var sel = window.getSelection();
			if (!sel || sel.isCollapsed || !sel.rangeCount) {
				dismissSelectionBar();
				return;
			}
			var text = sel.toString().trim();
			if (text.length === 0) {
				dismissSelectionBar();
				return;
			}

			var range = sel.getRangeAt(0);
			var container = range.commonAncestorContainer;
			var el = container && container.nodeType === 1 ? container : (container ? container.parentElement : null);
			if (el === null) {
				dismissSelectionBar();
				return;
			}

			if (typeof el.closest === "function") {
				if (el.closest('input, textarea, [contenteditable="true"], .dsh-selection-toolbar, [data-composer-input]')) {
					dismissSelectionBar();
					return;
				}
				if (!el.closest(CONTENT + ", .md-code-block, [data-conversation-session]")) {
					dismissSelectionBar();
					return;
				}
			}

			showSelectionBar(range, text, el);
		}

		/* ------------------------------------------------------------------ *
		 * Button injection
		 * ------------------------------------------------------------------ */

		function pressButton(block, button) {
			var code = codeOf(block);
			if (code.trim() === "") return;
			var lang = languageOf(block);
			var sessionId = sessionOf(block);
			var turn = turnOf(block);
			var meta = turn ? { turn: turn } : undefined;
			var done = insertQuote(sessionId, code, lang, meta) || insertPayload(sessionId, code, lang, meta);
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
			if (typeof window !== "undefined" && window.document !== undefined) {
				if (typeof window.document.addEventListener === "function") {
					window.document.addEventListener("mouseup", onSelectionChange);
					window.document.addEventListener("selectionchange", function () {
						var sel = window.getSelection();
						if (!sel || sel.isCollapsed) dismissSelectionBar();
					});
				}
				if (typeof window.addEventListener === "function") {
					window.addEventListener("scroll", dismissSelectionBar, true);
				}
			}

			if (typeof window.MutationObserver !== "function") {
				scan();
				return;
			}
			observer = new window.MutationObserver(function (records) {
				for (var index = 0; index < records.length; index += 1) {
					var record = records[index];
					// Ignore mutations inside our own quote cards or selection bar
					if (record.target && record.target.closest?.("[" + ATTR_CARD_ENHANCED + "], .dsh-selection-toolbar")) continue;

					var added = record.addedNodes;
					for (var at = 0; at < added.length; at += 1) {
						var node = added[at];
						if (node === null) continue;
						if (node.nodeType === 3) {
							if ((node.nodeValue || "").indexOf(QUOTE_MARK) >= 0) {
								scan();
								return;
							}
							continue;
						}
						if (node.nodeType !== 1) continue;
						if (node.matches?.(BANNER) === true || node.querySelector?.(BANNER) !== null ||
							node.matches?.(".btw-official-quote-node, [data-quote-preview]") === true ||
							node.querySelector?.(".btw-official-quote-node, [data-quote-preview]") !== null ||
							(node.textContent || "").indexOf(QUOTE_MARK) >= 0) {
							scan();
							return;
						}
					}
					if (record.type === "characterData") {
						if ((record.target?.nodeValue || "").indexOf(QUOTE_MARK) >= 0) {
							scan();
							return;
						}
					}
					if (record.type === "childList" && record.target !== null && record.target.nodeType === 1) {
						if (record.target.matches?.(BANNER) === true || record.target.closest?.(BANNER) !== null ||
							record.target.matches?.(".btw-official-quote-node, [data-quote-preview]") === true ||
							record.target.closest?.(".btw-official-quote-node, [data-quote-preview]") !== null ||
							(record.target.textContent || "").indexOf(QUOTE_MARK) >= 0) {
							scan();
							return;
						}
					}
				}
			});
			observer.observe(window.document.body, { childList: true, subtree: true, characterData: true });
			scan();
		}

		function stopScanning() {
			if (typeof window !== "undefined" && window.document !== undefined) {
				if (typeof window.document.removeEventListener === "function") {
					window.document.removeEventListener("mouseup", onSelectionChange);
				}
				if (typeof window.removeEventListener === "function") {
					window.removeEventListener("scroll", dismissSelectionBar, true);
				}
			}
			dismissSelectionBar();

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
			".dsh-quote-card-actions{display:flex;align-items:center;gap:4px;}",
			".dsh-quote-card-jump{",
			"border:0;background:transparent;color:var(--dsw-alias-label-secondary,#8a8a93);",
			"font-size:11.5px;cursor:pointer;padding:2px 6px;border-radius:4px;",
			"transition:color .12s ease,background-color .12s ease;",
			"}",
			".dsh-quote-card-jump:hover{",
			"color:var(--dsw-alias-state-business-primary,#4d6bfe);",
			"background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));",
			"}",
			".dsh-quote-card-toggle{",
			"border:0;background:transparent;color:var(--dsw-alias-state-business-primary,#4d6bfe);",
			"font-size:11.5px;cursor:pointer;padding:2px 6px;border-radius:4px;",
			"transition:background-color .12s ease;",
			"}",
			".dsh-quote-card-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));}",
			"@keyframes dsh-quote-flash{",
			"0%{box-shadow:0 0 0 3px var(--dsw-alias-state-business-primary,#4d6bfe),0 0 16px rgba(77,107,254,.45);}",
			"60%{box-shadow:0 0 0 3px var(--dsw-alias-state-business-primary,#4d6bfe),0 0 16px rgba(77,107,254,.45);}",
			"100%{box-shadow:none;}",
			"}",
			".dsh-quote-target-flash{",
			"animation:dsh-quote-flash 1.8s cubic-bezier(.16,1,.3,1) forwards;",
			"border-radius:8px;",
			"}",
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
			"}",
			".dsh-quote-card[data-quote-kind=\"prose\"] .dsh-quote-card-body pre{",
			"font-family:inherit;font-size:13.5px;line-height:1.6;",
			"}",
			".dsh-quote-message-wrap{display:flex;flex-direction:column;gap:4px;width:100%;}",
			".dsh-quote-user-text{white-space:pre-wrap;word-break:break-word;line-height:1.6;}",
			/* BTW-style Floating Selection Toolbar */
			".dsh-selection-toolbar{",
			"position:fixed;display:inline-flex;align-items:center;gap:4px;",
			"z-index:2147483600;padding:3px;margin:0;",
			"background:var(--dsw-alias-button-floating-fill,rgba(28,28,32,.94));",
			"border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.12));",
			"box-shadow:var(--dsw-elevation-panel,0 8px 24px rgba(0,0,0,.28));",
			"border-radius:999px;user-select:none;pointer-events:auto;",
			"transform:translateX(-50%);",
			"animation:dsh-pill-pop .12s cubic-bezier(.16,1,.3,1) forwards;",
			"}",
			"@keyframes dsh-pill-pop{",
			"0%{opacity:0;transform:translate(-50%,4px) scale(.95);}",
			"100%{opacity:1;transform:translate(-50%,0) scale(1);}",
			"}",
			".dsh-selection-btn{",
			"display:inline-flex;align-items:center;justify-content:center;gap:4px;",
			"border:0;background:transparent;color:var(--dsw-alias-label-primary,#f4f4f5);",
			"font-family:inherit;font-size:12px;font-weight:500;line-height:18px;",
			"padding:3px 10px;border-radius:999px;cursor:pointer;white-space:nowrap;",
			"transition:background-color .12s ease,color .12s ease;",
			"}",
			".dsh-selection-btn:hover{",
			"background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.12));",
			"color:#fff;",
			"}",
			".dsh-selection-btn-side{color:var(--dsw-alias-state-business-primary,#4d6bfe);}",
			".dsh-selection-btn-side:hover{background:rgba(77,107,254,.16);color:#708aff;}"
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
			createFoldCard: createFoldCard,
			extractQuoteTurn: extractQuoteTurn,
			codeFingerprintOf: codeFingerprintOf,
			jumpToSource: jumpToSource,
			turnOf: turnOf,
			showSelectionBar: showSelectionBar,
			dismissSelectionBar: dismissSelectionBar,
			openSideChatComposer: openSideChatComposer,
			splitRawQuoteMessage: splitRawQuoteMessage
		};

		return module.exports;
	}
});
