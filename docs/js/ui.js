// ─────────────────────────────────────────────────────────────────────────────
// ui.js  –  All DOM rendering helpers (no game logic, no Supabase)
// ─────────────────────────────────────────────────────────────────────────────

// ── Screen transitions ────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

// ── Generic element factory ───────────────────────────────────────────────────

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ── Grid rendering ────────────────────────────────────────────────────────────
//
// Renders a 10×10 battle grid into containerId.
// board     – 10×10 array of { shipId, hit }
// options:
//   showShips   – show ship cells as filled (default true)
//   clickable   – attach click handlers (default false)
//   locked      – disable hover/click even if clickable (default false)
//   onCellClick – fn(row, col)

function renderGrid(containerId, board, options = {}) {
  const { showShips = true, clickable = false, locked = false, onCellClick } = options;
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (locked) container.classList.add('locked');
  else        container.classList.remove('locked');

  // Corner spacer
  container.appendChild(el('div', 'grid-corner'));

  // Column headers A–J
  for (let c = 0; c < 10; c++) {
    container.appendChild(el('div', 'grid-header', String.fromCharCode(65 + c)));
  }

  for (let r = 0; r < 10; r++) {
    // Row number header
    const rowHdr = el('div', 'grid-header row-header', String(r + 1));
    container.appendChild(rowHdr);

    for (let c = 0; c < 10; c++) {
      const cell  = board[r][c];
      const div   = el('div', buildCellClass(cell, showShips));
      div.dataset.row = r;
      div.dataset.col = c;

      if (clickable && !locked && onCellClick && !cell.hit) {
        div.addEventListener('click', () => onCellClick(r, c));
      }
      container.appendChild(div);
    }
  }
}

function buildCellClass(cell, showShips) {
  const classes = ['cell'];
  if (showShips && cell.shipId && !cell.hit) classes.push('has-ship');
  if (cell.hit  && cell.shipId)  classes.push('hit-mine');
  if (cell.hit  && !cell.shipId) classes.push('miss-mine');
  return classes.join(' ');
}

// Build class for the enemy (attack) grid – ships are hidden until hit.
function buildEnemyCellClass(cell) {
  const classes = ['cell'];
  if (cell.hit && cell.shipId)  classes.push('hit-enemy');
  if (cell.hit && !cell.shipId) classes.push('miss-enemy');
  return classes.join(' ');
}

function renderEnemyGrid(containerId, displayBoard, clickable, locked, onCellClick) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (locked) container.classList.add('locked');
  else        container.classList.remove('locked');

  container.appendChild(el('div', 'grid-corner'));
  for (let c = 0; c < 10; c++) {
    container.appendChild(el('div', 'grid-header', String.fromCharCode(65 + c)));
  }

  for (let r = 0; r < 10; r++) {
    container.appendChild(el('div', 'grid-header row-header', String(r + 1)));
    for (let c = 0; c < 10; c++) {
      const cell = displayBoard[r][c];
      const div  = el('div', buildEnemyCellClass(cell));
      div.dataset.row = r;
      div.dataset.col = c;

      if (clickable && !locked && onCellClick && !cell.hit) {
        div.addEventListener('click', () => onCellClick(r, c));
      }
      container.appendChild(div);
    }
  }
}

// ── Placement grid ────────────────────────────────────────────────────────────
//
// Same as renderGrid but also overlays a hover preview for the ship being placed.

function renderPlacementGrid(board, placingShip, hoverRow, hoverCol, horizontal) {
  const container = document.getElementById('placement-grid');
  container.innerHTML = '';

  // Compute preview cells
  let previewCells = new Set();
  let previewValid = false;
  if (placingShip && hoverRow !== null && hoverCol !== null) {
    const cells = getShipCells(hoverRow, hoverCol, placingShip.size, horizontal);
    previewValid = isValidPlacement(board, cells);
    cells.forEach(({ row, col }) => previewCells.add(`${row},${col}`));
  }

  container.appendChild(el('div', 'grid-corner'));
  for (let c = 0; c < 10; c++) {
    container.appendChild(el('div', 'grid-header', String.fromCharCode(65 + c)));
  }

  for (let r = 0; r < 10; r++) {
    container.appendChild(el('div', 'grid-header row-header', String(r + 1)));
    for (let c = 0; c < 10; c++) {
      const cell    = board[r][c];
      const inPrev  = previewCells.has(`${r},${c}`);
      const classes = ['cell'];

      if (cell.shipId)                   classes.push('has-ship');
      else if (inPrev && previewValid)   classes.push('preview-ok');
      else if (inPrev && !previewValid)  classes.push('preview-bad');

      const div = el('div', classes.join(' '));
      div.dataset.row = r;
      div.dataset.col = c;
      container.appendChild(div);
    }
  }
}

// ── Ship list sidebar ─────────────────────────────────────────────────────────

function renderShipList(currentIndex) {
  const container = document.getElementById('ships-to-place');
  container.innerHTML = '<h3>Ships</h3>';

  SHIPS.forEach((ship, i) => {
    const placed = i < currentIndex;
    const active = i === currentIndex;

    const div = el('div', `ship-item${placed ? ' placed' : ''}${active ? ' active' : ''}`);
    div.innerHTML = `
      <span class="ship-name">${ship.name}</span>
      <span class="ship-cells">${'■'.repeat(ship.size)}</span>
    `;
    container.appendChild(div);
  });
}

// ── Battle log ────────────────────────────────────────────────────────────────

function addBattleLog(message, type) {
  const log = document.getElementById('battle-log');
  const entry = el('div', `log-entry${type ? ' log-' + type : ''}`, message);
  log.insertBefore(entry, log.firstChild);

  // Keep at most 10 entries
  while (log.children.length > 10) log.removeChild(log.lastChild);
}

// ── Turn indicator ────────────────────────────────────────────────────────────

function setTurnIndicator(isMyTurn) {
  const el2 = document.getElementById('turn-indicator');
  el2.textContent = isMyTurn ? '🎯 Your Turn — Fire!' : '⏳ Opponent\'s Turn…';
  el2.className   = 'turn-indicator ' + (isMyTurn ? 'my-turn' : 'their-turn');
}

// ── QR code generation ────────────────────────────────────────────────────────

function generateQR(roomCode) {
  const base    = location.href.split('?')[0];
  const joinUrl = `${base}?join=${roomCode}`;

  document.getElementById('room-code-text').textContent = roomCode;
  document.getElementById('qrcode').innerHTML = '';

  new QRCode(document.getElementById('qrcode'), {
    text:          joinUrl,
    width:         200,
    height:        200,
    colorDark:     '#0a1628',
    colorLight:    '#ffffff',
    correctLevel:  QRCode.CorrectLevel.H,
  });

  return joinUrl;
}

// ── Coordinate helper ─────────────────────────────────────────────────────────

function coordLabel(row, col) {
  return String.fromCharCode(65 + col) + (row + 1);
}
