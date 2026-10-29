/* Freemiere Pro — in-app drag and drop (media, effects, graphics, source clips).
   Pointer-based rather than HTML5 drag, so it behaves the same on every Mac and
   targets can show live previews (clip ghosts, drop zones). Panels register
   drop targets with FL.dnd.target({ match, over, drop, leave }). */
'use strict';

(() => {
  const targets = [];
  const ghost = document.createElement('div');
  ghost.id = 'dnd-ghost';
  ghost.hidden = true;
  document.body.appendChild(ghost);

  let pending = null;   // pointer down, not yet moved far enough
  let drag = null;      // active drag: { payload, target, state }

  FL.dnd = {
    target: (t) => { targets.push(t); },
    active: () => !!drag,
    hint: (text) => { ghost.querySelector('.dnd-hint').textContent = text || ''; },
  };

  // Call from a pointerdown handler. makePayload() runs only if the pointer actually drags.
  FL.dnd.press = (e, makePayload, label) => {
    if (e.button !== 0) return;
    pending = { x: e.clientX, y: e.clientY, makePayload, label };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  function begin(e) {
    const payload = pending.makePayload();
    const label = typeof pending.label === 'function' ? pending.label() : pending.label;
    pending = null;
    if (!payload) { stopListening(); return; }
    drag = { payload, target: null, state: null };
    ghost.innerHTML = `<span class="dnd-label">${FL.esc(label || '')}</span><span class="dnd-hint"></span>`;
    ghost.hidden = false;
    document.body.classList.add('dnd-active');
    FL.hideMenu && FL.hideMenu();
    move(e);
  }

  function move(e) {
    ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const t = el ? targets.find((x) => x.match(el, drag.payload)) : null;
    if (t !== drag.target) {
      if (drag.target && drag.target.leave) drag.target.leave();
      drag.target = t;
      FL.dnd.hint('');
    }
    drag.state = t ? t.over(drag.payload, e, el) : null;
    ghost.classList.toggle('no', !drag.state);
  }

  function onMove(e) {
    if (pending) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 5) return;
      begin(e);
      return;
    }
    if (drag) move(e);
  }

  function onUp(e) {
    stopListening();
    if (pending) { pending = null; return; }
    if (!drag) return;
    const { payload, target, state } = drag;
    end();
    if (target && state) target.drop(payload, e, state);
  }

  function end() {
    if (drag && drag.target && drag.target.leave) drag.target.leave();
    drag = null;
    ghost.hidden = true;
    document.body.classList.remove('dnd-active');
  }
  function stopListening() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }

  // Modifier keys change the drop mode (e.g. ⌘ = insert); re-evaluate on key changes.
  let lastEvent = null;
  window.addEventListener('pointermove', (e) => { lastEvent = e; }, true);
  const refresh = (e) => {
    if (!drag || !lastEvent) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); stopListening(); return; }
    const ev = new PointerEvent('pointermove', { clientX: lastEvent.clientX, clientY: lastEvent.clientY, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey });
    move(ev);
  };
  window.addEventListener('keydown', refresh, true);
  window.addEventListener('keyup', refresh, true);
})();
