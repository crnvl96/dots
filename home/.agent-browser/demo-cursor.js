// Loaded by browser-demo recording, not by normal browsing. The native recording
// host is a lifecycle signal; its closed shadow DOM is deliberately left alone.
(() => {
  if (globalThis.__browserDemoCursorInstalled) return;
  globalThis.__browserDemoCursorInstalled = true;
  let host, pointer, shadow, nativeHost;
  let last;
  const selector = '[data-agent-browser-recording-cursor]';

  function sync() {
    const recording = document.querySelector(selector);
    if (recording === nativeHost) return;
    if (!recording && nativeHost) {
      observer.disconnect();
      for (const type of ['pointermove', 'pointerdown', 'pointerup'])
        removeEventListener(type, update, true);
      removeEventListener('pointerout', pointerOut, true);
      delete globalThis.__browserDemoCursorInstalled;
    }
    host?.remove();
    host = pointer = shadow = null;
    nativeHost = recording;
    if (!recording || !document.documentElement) return;
    // Avoid rendering both the native white arrow and our neon arrow.
    recording.style.setProperty('visibility', 'hidden', 'important');
    host = document.createElement('browser-demo-cursor');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('inert', '');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;overflow:visible!important;';
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host, * { pointer-events: none !important; }
      .pointer { position: fixed; top: 0; left: 0; display: none; will-change: transform; }
      .halo { position: absolute; width: 48px; height: 48px; left: -24px; top: -24px; border-radius: 50%; background: radial-gradient(circle, #22d3ee55, #a855f722 50%, transparent 72%); }
      svg { position: relative; display: block; width: 34px; height: 34px; overflow: visible; transform-origin: 0 0; filter: drop-shadow(0 0 5px #22d3ee) drop-shadow(0 2px 2px #000a); transition: transform 100ms ease-out; }
      .pressed svg { transform: scale(.85); }
      .ring { position: fixed; width: 104px; height: 104px; margin: -52px; border-radius: 50%; border: 3px solid #22d3ee; box-sizing: border-box; box-shadow: 0 0 18px #22d3ee99, inset 0 0 16px #a855f766; animation: burst 700ms cubic-bezier(.16,1,.3,1) forwards; }
      .ring.second { width: 76px; height: 76px; margin: -38px; border-color: #e879f9; animation-duration: 900ms; }
      .flash { position: fixed; width: 48px; height: 48px; margin: -24px; border-radius: 50%; background: radial-gradient(circle, #fff, #22d3ee99 25%, #a855f755 50%, transparent 72%); animation: burst 450ms ease-out forwards; }
      @keyframes burst { from { transform: scale(.15); opacity: 1; } to { transform: scale(1.2); opacity: 0; } }
    </style><div class="pointer"><div class="halo"></div><svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="neon" x2="1" y2="1"><stop stop-color="#67e8f9"/><stop offset="1" stop-color="#c084fc"/></linearGradient></defs><path d="M0 0L16 9L8 11L4.5 18Z" fill="url(#neon)" stroke="white" stroke-width="1.3" stroke-linejoin="round"/></svg></div>`;
    pointer = shadow.querySelector('.pointer');
    document.documentElement.appendChild(host);
    if (last) move(last);
  }

  function move(event) {
    pointer.style.display = 'block';
    // Follow the real, eased input events without visual lag at click time.
    pointer.style.transform = `translate3d(${event.clientX}px,${event.clientY}px,0)`;
    pointer.classList.toggle('pressed', event.buttons !== 0);
  }
  function update(event) {
    if (!event.isTrusted || event.pointerType !== 'mouse') return;
    last = event;
    if (!pointer) return;
    move(event);
    if (event.type !== 'pointerdown') return;
    for (const className of ['flash', 'ring', 'ring second']) {
      const effect = document.createElement('div');
      effect.className = className;
      effect.style.left = `${event.clientX}px`;
      effect.style.top = `${event.clientY}px`;
      effect.addEventListener('animationend', () => effect.remove(), { once: true });
      shadow.insertBefore(effect, pointer);
    }
  }
  for (const type of ['pointermove', 'pointerdown', 'pointerup'])
    addEventListener(type, update, { capture: true, passive: true });
  function pointerOut(event) {
    if (!event.relatedTarget && pointer) pointer.style.display = 'none';
  }
  addEventListener('pointerout', pointerOut, { capture: true, passive: true });
  // Survives full navigation, and removes the overlay automatically on record stop.
  const observer = new MutationObserver(sync);
  observer.observe(document, { childList: true, subtree: true });
  sync();
})();
