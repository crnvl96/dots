// Demo-recording init script, configured by runtime.sh from environment variables.
// Runs before page JS on every navigation. Client-side only: it never writes server data.
//  1. Optional dark theme overrides: runtime configuration supplies the authorized
//     app origin, localStorage key and JSON profile field. No app-specific values here.
//  2. A macOS-style pointer overlay (black arrow, white outline, soft shadow) that follows
//     mouse events, with a flashy ring on mousedown, plus window.__glide(x, y, ms) as a
//     fallback for scripted moves.
(() => {
	if (window.top !== window) return; // top frame only
	const config = window.__demoConfig || {};
	const APP = location.origin === config.origin;

	if (APP && config.themeStorageKey) {
		try {
			localStorage.setItem(config.themeStorageKey, "dark");
		} catch (_) {}
	}
	if (APP && config.themeProfileField) {
		const field = JSON.stringify(config.themeProfileField).slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const themePattern = new RegExp('("' + field + '"\\s*:\\s*)"(light|system)"', "g");
		const origFetch = window.fetch;
		window.fetch = async function (...args) {
			const res = await origFetch.apply(this, args);
			try {
				const ct = res.headers.get("content-type") || "";
				if (!ct.includes("json")) return res;
				const text = await res.clone().text();
				const patched = text.replace(themePattern, '$1"dark"');
				if (patched === text) return res;
				return new Response(patched, { status: res.status, statusText: res.statusText, headers: res.headers });
			} catch (_) {
				return res;
			}
		};
	}

	if (window.__demoCursor) return;
	window.__demoCursor = true;

	const RING = "#FF2BD6";
	const W = 16, H = 24; // macOS arrow is ~24 px tall at 1x
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 16 24" style="display:block;overflow:visible;transform-origin:1px 1px;transition:transform 90ms ease-out">` +
		`<path d="M1.2 1.2 L1.2 18.6 L5.3 14.7 L8.1 21.4 L11 20.2 L8.3 13.7 L14 13.7 Z" ` +
		`fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

	let x = -100, y = -100;
	const cursor = document.createElement("div");
	cursor.id = "__demo-cursor";
	cursor.setAttribute("aria-hidden", "true");
	cursor.innerHTML = svg;
	cursor.style.cssText =
		`position:fixed;left:0;top:0;width:${W}px;height:${H}px;` +
		"pointer-events:none;z-index:2147483647;will-change:transform;" +
		"filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45)) drop-shadow(0 2px 4px rgba(0,0,0,.3));" +
		"transition:transform 80ms linear;transform:translate(-100px,-100px);";
	const arrow = () => cursor.firstElementChild;
	const TIP_X = 1.2, TIP_Y = 1.2;
	const place = (nx, ny, ms) => {
		x = nx; y = ny;
		cursor.style.transition = ms ? `transform ${ms}ms cubic-bezier(.4,0,.2,1)` : "transform 80ms linear";
		cursor.style.transform = `translate(${nx - TIP_X}px,${ny - TIP_Y}px)`;
	};

	const style = document.createElement("style");
	style.textContent =
		"@keyframes __demo-ring{0%{width:20px;height:20px;opacity:1;border-width:4px}" +
		"100%{width:70px;height:70px;opacity:0;border-width:2px}}" +
		"@keyframes __demo-dot{0%{opacity:.85;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(.4)}}" +
		".__demo-ring{position:fixed;pointer-events:none;z-index:2147483646;border-radius:50%;box-sizing:border-box;" +
		`border:4px solid ${RING};box-shadow:0 0 12px 3px ${RING}cc,inset 0 0 8px 1px ${RING}99;` +
		"transform:translate(-50%,-50%);animation:__demo-ring 450ms ease-out forwards}" +
		".__demo-dot{position:fixed;pointer-events:none;z-index:2147483646;width:16px;height:16px;border-radius:50%;" +
		`background:${RING};box-shadow:0 0 10px 2px ${RING};animation:__demo-dot 300ms ease-out forwards}`;

	const mount = () => {
		const root = document.documentElement;
		if (!root) return;
		if (!style.isConnected) (document.head || root).appendChild(style);
		if (!cursor.isConnected || root.lastElementChild !== cursor) root.appendChild(cursor);
	};
	const fx = (cls, cx, cy, ms) => {
		const el = document.createElement("div");
		el.className = cls;
		el.setAttribute("aria-hidden", "true");
		el.style.left = cx + "px";
		el.style.top = cy + "px";
		document.documentElement.appendChild(el);
		setTimeout(() => el.remove(), ms);
	};

	const onMove = (e) => place(e.clientX, e.clientY);
	addEventListener("mousemove", onMove, true);
	addEventListener("pointermove", onMove, true);
	addEventListener(
		"mousedown",
		(e) => {
			place(e.clientX, e.clientY);
			fx("__demo-ring", e.clientX, e.clientY, 500);
			fx("__demo-dot", e.clientX, e.clientY, 350);
			const a = arrow();
			if (a) a.style.transform = "scale(.9)";
		},
		true,
	);
	addEventListener(
		"mouseup",
		() => {
			const a = arrow();
			if (a) setTimeout(() => (a.style.transform = ""), 90);
		},
		true,
	);

	// Fallback for scripted moves without real mouse events.
	window.__glide = (nx, ny, ms = 800) => {
		mount();
		place(nx, ny, ms);
		return new Promise((res) => setTimeout(res, ms));
	};
	window.__cursorPos = () => ({ x, y });

	const start = () => {
		mount();
		new MutationObserver(mount).observe(document.documentElement, { childList: true });
	};
	if (document.documentElement) start();
	else document.addEventListener("readystatechange", start, { once: true });
})();
