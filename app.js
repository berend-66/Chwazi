(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const hint = document.getElementById('hint');
  const settingsBtn = document.getElementById('settingsBtn');
  const rigIndicator = document.getElementById('rigIndicator');
  const settingsPanel = document.getElementById('settingsPanel');
  const closeSettings = document.getElementById('closeSettings');
  const modeSelector = document.getElementById('modeSelector');
  const groupsSetting = document.getElementById('groupsSetting');
  const groupsSlider = document.getElementById('groupsSlider');
  const groupsValue = document.getElementById('groupsValue');
  const delaySlider = document.getElementById('delaySlider');
  const delayValue = document.getElementById('delayValue');
  const vibrateToggle = document.getElementById('vibrateToggle');

  const PALETTE = [
    '#ff3b5c', // red
    '#3b9bff', // blue
    '#3bd97a', // green
    '#ffd23b', // yellow
    '#b06bff', // purple
    '#ff8c3b', // orange
    '#ff6bd9', // pink
    '#3bdfd9', // cyan
  ];

  const STATE = {
    IDLE: 'idle',
    WAITING: 'waiting',
    RESULT: 'result',
  };

  const settings = {
    mode: 'one',     // 'one' | 'groups' | 'order'
    groupCount: 2,
    delayMs: 3000,
    vibrate: true,
  };

  let phase = STATE.IDLE;
  let pointers = new Map(); // id -> pointer
  let pointerOrder = [];    // ids in placement order; last entry = most recent
  let selectionStart = 0;   // ms timestamp when waiting started/restarted
  let resultStart = 0;
  let nextColorIdx = 0;

  // Rigging: 4 quick taps in the top-left corner during IDLE cycle the state.
  let rigState = 'off'; // 'off' | 'win' | 'lose'
  let rigTapTimes = [];
  const RIG_ZONE = 80;
  const RIG_TAP_WINDOW = 1500;
  const RIG_TAP_COUNT = 4;

  function updateRigIndicator() {
    rigIndicator.className = 'rig-indicator';
    if (rigState !== 'off') rigIndicator.classList.add(rigState);
  }

  function cycleRigState() {
    rigState = rigState === 'off' ? 'win' : rigState === 'win' ? 'lose' : 'off';
    updateRigIndicator();
    if (settings.vibrate && navigator.vibrate) navigator.vibrate(30);
  }

  function handleRigTap(e) {
    const now = performance.now();
    rigTapTimes = rigTapTimes.filter(t => now - t < RIG_TAP_WINDOW);
    rigTapTimes.push(now);
    if (rigTapTimes.length >= RIG_TAP_COUNT) {
      cycleRigState();
      rigTapTimes = [];
    }
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function pickColor() {
    const used = new Set([...pointers.values()].map(p => p.color));
    for (let i = 0; i < PALETTE.length; i++) {
      const c = PALETTE[(nextColorIdx + i) % PALETTE.length];
      if (!used.has(c)) {
        nextColorIdx = (nextColorIdx + i + 1) % PALETTE.length;
        return c;
      }
    }
    return PALETTE[Math.floor(Math.random() * PALETTE.length)];
  }

  function addPointer(e) {
    if (pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      color: pickColor(),
      addedAt: performance.now(),
      // result fields:
      selected: null,    // true/false in 'one' mode
      group: null,       // group color in 'groups' mode
      order: null,       // 1-based number in 'order' mode
      shrink: false,     // animate out in 'one' mode (losers)
    });
    pointerOrder.push(e.pointerId);
    onPointersChanged();
  }

  function movePointer(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
  }

  function removePointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    pointerOrder = pointerOrder.filter(id => id !== e.pointerId);
    onPointersChanged();
  }

  function onPointersChanged() {
    if (pointers.size === 0) {
      phase = STATE.IDLE;
      hint.classList.remove('hidden');
      return;
    }
    hint.classList.add('hidden');
    if (phase === STATE.RESULT) {
      // Any change after a result resets selection
      clearResults();
    }
    // Restart countdown whenever the set of fingers changes
    phase = STATE.WAITING;
    selectionStart = performance.now();
  }

  function clearResults() {
    for (const p of pointers.values()) {
      p.selected = null;
      p.group = null;
      p.order = null;
      p.shrink = false;
    }
  }

  function runSelection() {
    const ids = [...pointers.keys()];
    if (settings.mode === 'one') {
      if (ids.length < 2) return false; // need at least 2 to pick one
      let winner;
      const lastId = pointerOrder[pointerOrder.length - 1];
      const lastValid = lastId !== undefined && pointers.has(lastId);
      if (rigState === 'win' && lastValid) {
        winner = lastId;
      } else if (rigState === 'lose' && lastValid && ids.length >= 2) {
        const others = ids.filter(id => id !== lastId);
        winner = others[Math.floor(Math.random() * others.length)];
      } else {
        winner = ids[Math.floor(Math.random() * ids.length)];
      }
      for (const [id, p] of pointers) {
        if (id === winner) {
          p.selected = true;
        } else {
          p.selected = false;
          p.shrink = true;
        }
      }
    } else if (settings.mode === 'groups') {
      const n = Math.min(settings.groupCount, ids.length);
      if (n < 2) return false;
      // Shuffle ids
      const shuffled = ids.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      // Assign each pointer a group color
      const groupColors = PALETTE.slice(0, n);
      shuffled.forEach((id, idx) => {
        const groupIdx = idx % n;
        const p = pointers.get(id);
        p.group = groupColors[groupIdx];
      });
    } else if (settings.mode === 'order') {
      if (ids.length < 2) return false;
      const shuffled = ids.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      shuffled.forEach((id, idx) => {
        pointers.get(id).order = idx + 1;
      });
    }
    if (settings.vibrate && navigator.vibrate) {
      navigator.vibrate(80);
    }
    return true;
  }

  function update(now) {
    if (phase === STATE.WAITING && pointers.size >= 1) {
      const elapsed = now - selectionStart;
      if (elapsed >= settings.delayMs) {
        const ok = runSelection();
        if (ok) {
          phase = STATE.RESULT;
          resultStart = now;
        } else {
          // Not enough fingers for the chosen mode; keep waiting
          selectionStart = now;
        }
      }
    }
  }

  function drawWaitingRing(p, now, progress) {
    // progress in [0,1] — how close we are to selection
    const baseRadius = 60;
    const radius = baseRadius + Math.sin(now / 250) * 3;
    const rotation = (now / 600) % (Math.PI * 2);
    const lineWidth = 6 + progress * 4;

    // Faint background ring
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = p.color + '33';
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Rotating dashes
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(rotation);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    const dashCount = 12;
    const arc = (Math.PI * 2) / dashCount;
    const gap = arc * 0.45;
    for (let i = 0; i < dashCount; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, radius, i * arc, i * arc + (arc - gap));
      ctx.stroke();
    }
    ctx.restore();

    // Inner dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }

  function drawWinner(p, now) {
    const elapsed = now - resultStart;
    const t = Math.min(1, elapsed / 600);
    const eased = 1 - Math.pow(1 - t, 3);

    const w = window.innerWidth;
    const h = window.innerHeight;
    const maxDist = Math.hypot(
      Math.max(p.x, w - p.x),
      Math.max(p.y, h - p.y)
    );
    const innerRadius = 75 + Math.sin(now / 250) * 3;
    const outerRadius = innerRadius + eased * (maxDist + 80);

    ctx.beginPath();
    ctx.arc(p.x, p.y, outerRadius, 0, Math.PI * 2);
    ctx.arc(p.x, p.y, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill('evenodd');
  }

  function drawShrinking(p, now) {
    const elapsed = now - resultStart;
    const t = Math.min(1, elapsed / 400);
    const radius = 60 * (1 - t);
    if (radius <= 0) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8 * (1 - t), 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }

  function drawGroupRing(p, now) {
    const elapsed = now - resultStart;
    const t = Math.min(1, elapsed / 400);
    const eased = 1 - Math.pow(1 - t, 3);
    const radius = 60 + eased * 30;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = p.group + 'cc';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = p.group;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  function drawOrderRing(p, now) {
    const elapsed = now - resultStart;
    const t = Math.min(1, elapsed / 400);
    const radius = 70;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = 'bold 56px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = t;
    ctx.fillText(String(p.order), p.x, p.y + 2);
    ctx.globalAlpha = 1;
  }

  function render(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (phase === STATE.WAITING) {
      const progress = Math.min(1, (now - selectionStart) / settings.delayMs);
      for (const p of pointers.values()) {
        drawWaitingRing(p, now, progress);
      }
    } else if (phase === STATE.RESULT) {
      // Draw losers first, winners on top
      const list = [...pointers.values()];
      if (settings.mode === 'one') {
        for (const p of list) if (p.shrink) drawShrinking(p, now);
        for (const p of list) if (p.selected) drawWinner(p, now);
      } else if (settings.mode === 'groups') {
        for (const p of list) drawGroupRing(p, now);
      } else if (settings.mode === 'order') {
        for (const p of list) drawOrderRing(p, now);
      }
    }
  }

  function loop(now) {
    update(now);
    render(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- Pointer event wiring ----
  function isFromSettings(e) {
    return e.target && e.target.closest && e.target.closest('.settings-btn, .settings-panel');
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (
      phase === STATE.IDLE &&
      e.clientX < RIG_ZONE &&
      e.clientY < RIG_ZONE
    ) {
      handleRigTap(e);
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    addPointer(e);
  });
  canvas.addEventListener('pointermove', e => {
    e.preventDefault();
    movePointer(e);
  });
  const endHandler = e => {
    e.preventDefault();
    removePointer(e);
  };
  canvas.addEventListener('pointerup', endHandler);
  canvas.addEventListener('pointercancel', endHandler);
  canvas.addEventListener('pointerleave', endHandler);

  // Prevent context menu / scrolling on long-press
  document.addEventListener('contextmenu', e => {
    if (!isFromSettings(e)) e.preventDefault();
  });
  document.addEventListener('gesturestart', e => e.preventDefault());

  // ---- Settings UI ----
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
  });
  closeSettings.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });
  settingsPanel.addEventListener('click', e => {
    if (e.target === settingsPanel) settingsPanel.classList.add('hidden');
  });

  modeSelector.addEventListener('click', e => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    settings.mode = btn.dataset.mode;
    [...modeSelector.querySelectorAll('button')].forEach(b =>
      b.classList.toggle('active', b === btn)
    );
    groupsSetting.classList.toggle('disabled', settings.mode !== 'groups');
    // Clear any current result when mode changes
    if (phase === STATE.RESULT) {
      clearResults();
      phase = pointers.size > 0 ? STATE.WAITING : STATE.IDLE;
      selectionStart = performance.now();
    }
  });

  groupsSlider.addEventListener('input', () => {
    settings.groupCount = parseInt(groupsSlider.value, 10);
    groupsValue.textContent = settings.groupCount;
  });

  delaySlider.addEventListener('input', () => {
    const v = parseFloat(delaySlider.value);
    settings.delayMs = v * 1000;
    delayValue.textContent = v.toFixed(1);
  });

  vibrateToggle.addEventListener('change', () => {
    settings.vibrate = vibrateToggle.checked;
  });

  // Initialize disabled state
  groupsSetting.classList.toggle('disabled', settings.mode !== 'groups');
})();
