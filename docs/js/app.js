// ─────────────────────────────────────────────────────────────────────────────
// app.js  –  Main state machine & event handlers
// ─────────────────────────────────────────────────────────────────────────────

// ── Application state ─────────────────────────────────────────────────────────

const S = {
  playerId:   null,
  roomId:     null,
  roomCode:   null,
  playerNum:  null,   // 1 | 2
  rules:      'classic',
  opponentId: null,
  phase:      'home', // home | lobby | placing | battle | gameover

  // Placement phase
  myBoard:          null,
  myShips:          [],
  placingIndex:     0,
  horizontal:       true,
  hoverRow:         null,
  hoverCol:         null,

  // Battle phase
  enemyRealBoard:    null,  // opponent's actual board (fetched from DB for hit detection)
  enemyDisplayBoard: null,  // what we show: hits/misses only, no ships
  isMyTurn:         false,
};

// Flags for placement synchronisation
let _myReady       = false;
let _opponentReady = false;

// ── Kick off ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  S.playerId = getOrCreatePlayerId();

  const params   = new URLSearchParams(location.search);
  const joinCode = params.get('join');

  if (joinCode) {
    // Player 2 arriving via QR / shared link
    joinViaUrl(joinCode);
  } else {
    initHomeScreen();
  }
});

// ── HOME ──────────────────────────────────────────────────────────────────────

function initHomeScreen() {
  S.phase = 'home';
  showScreen('home');

  // Rules selector
  document.querySelectorAll('.rule-card').forEach(card => {
    card.onclick = () => {
      document.querySelectorAll('.rule-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      S.rules = card.dataset.rules;
    };
  });

  document.getElementById('btn-new-game').onclick  = handleNewGame;
  document.getElementById('btn-join-game').onclick = () => initJoinScreen();
}

// ── NEW GAME (Player 1) ───────────────────────────────────────────────────────

async function handleNewGame() {
  const btn = document.getElementById('btn-new-game');
  btn.disabled    = true;
  btn.textContent = 'Creating…';

  try {
    const room = await dbCreateRoom(S.rules);
    S.roomId     = room.id;
    S.roomCode   = room.room_code;
    S.playerNum  = 1;
    S.opponentId = null;

    // Register handlers BEFORE showing lobby so we don't miss a fast join
    HANDLERS.onPlayerJoined = async (payload) => {
      S.opponentId = payload.playerId;
      document.getElementById('lobby-status').textContent  = '✅ Opponent joined! Starting…';
      document.getElementById('lobby-status').className    = 'status-pill ready';
      await new Promise(r => setTimeout(r, 900));
      initPlacementScreen();
    };
    HANDLERS.onShipsReady    = onOpponentShipsReady;
    HANDLERS.onMove          = onIncomingMove;
    HANDLERS.onGameOver      = onGameOver;
    HANDLERS.onPresenceLeave = onPresenceLeave;

    rtSubscribe(S.roomId);
    showLobby(room);

    // Fallback poll: detect player2_id appearing in DB (handles race with broadcast)
    const poll = setInterval(async () => {
      if (S.phase !== 'lobby') { clearInterval(poll); return; }
      try {
        const r = await dbGetRoom(S.roomId);
        if (r.player2_id && !S.opponentId) {
          S.opponentId = r.player2_id;
          clearInterval(poll);
          document.getElementById('lobby-status').textContent = '✅ Opponent joined! Starting…';
          document.getElementById('lobby-status').className   = 'status-pill ready';
          await new Promise(res => setTimeout(res, 900));
          initPlacementScreen();
        }
      } catch (_) {}
    }, 3000);

  } catch (err) {
    alert(err.message);
    btn.disabled    = false;
    btn.textContent = 'New Game';
  }
}

function showLobby(room) {
  S.phase = 'lobby';
  showScreen('lobby');
  generateQR(room.room_code);

  const badge = document.getElementById('rules-badge');
  badge.textContent = S.rules === 'classic'
    ? '⚓ Classic Rules – hit again on a hit'
    : '🔄 Modern Rules – turns always alternate';
}

// ── JOIN SCREEN (manual code entry) ──────────────────────────────────────────

function initJoinScreen() {
  showScreen('join');

  const errEl  = document.getElementById('join-error');
  const input  = document.getElementById('join-code-input');
  errEl.textContent = '';
  input.value       = '';

  document.getElementById('btn-join-submit').onclick = async () => {
    errEl.textContent = '';
    const code = input.value.trim();
    if (!code) { errEl.textContent = 'Please enter a room code.'; return; }
    await joinViaUrl(code);
  };

  document.getElementById('btn-back-home').onclick = initHomeScreen;
}

// ── JOIN via URL or manual code (Player 2) ────────────────────────────────────

async function joinViaUrl(code) {
  const errEl = document.getElementById('join-error');

  try {
    const room = await dbJoinRoom(code);

    S.roomId     = room.id;
    S.roomCode   = room.room_code;
    S.playerNum  = room._playerNum || 2;
    S.rules      = room.rules;
    S.opponentId = room.player1_id;

    HANDLERS.onShipsReady    = onOpponentShipsReady;
    HANDLERS.onMove          = onIncomingMove;
    HANDLERS.onGameOver      = onGameOver;
    HANDLERS.onPresenceLeave = onPresenceLeave;

    rtSubscribe(S.roomId);

    if (!room._rejoin) {
      // Tell Player 1 we're here
      await rtBroadcast('player_joined', { playerId: S.playerId });
    }

    // Check if game is already in battle phase (rejoin mid-game)
    if (room.status === 'battle' || room.status === 'finished') {
      await rejoinBattle(room);
    } else {
      initPlacementScreen();
    }

  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
    } else {
      showScreen('join');
      initJoinScreen();
      document.getElementById('join-error').textContent = err.message;
    }
  }
}

// ── SHIP PLACEMENT ────────────────────────────────────────────────────────────

function initPlacementScreen() {
  S.phase        = 'placing';
  S.myBoard      = createEmptyBoard();
  S.myShips      = [];
  S.placingIndex = 0;
  S.horizontal   = true;
  _myReady       = false;
  _opponentReady = false;

  showScreen('placement');
  renderShipList(0);
  renderPlacementGrid(S.myBoard, SHIPS[0], null, null, true);

  const grid = document.getElementById('placement-grid');

  grid.onmouseover = (e) => {
    const cell = e.target.closest('[data-row]');
    if (!cell || S.placingIndex >= SHIPS.length) return;
    S.hoverRow = +cell.dataset.row;
    S.hoverCol = +cell.dataset.col;
    renderPlacementGrid(S.myBoard, SHIPS[S.placingIndex], S.hoverRow, S.hoverCol, S.horizontal);
  };

  grid.onmouseleave = () => {
    S.hoverRow = null;
    S.hoverCol = null;
    if (S.placingIndex < SHIPS.length) {
      renderPlacementGrid(S.myBoard, SHIPS[S.placingIndex], null, null, S.horizontal);
    }
  };

  grid.onclick = (e) => {
    const cell = e.target.closest('[data-row]');
    if (!cell || S.placingIndex >= SHIPS.length) return;

    const row    = +cell.dataset.row;
    const col    = +cell.dataset.col;
    const result = placeShipOnBoard(S.myBoard, SHIPS[S.placingIndex], row, col, S.horizontal);
    if (!result) return;

    S.myBoard = result.board;
    S.myShips.push({ ...SHIPS[S.placingIndex], cells: result.cells, horizontal: S.horizontal, row, col });
    S.placingIndex++;

    renderShipList(S.placingIndex);

    if (S.placingIndex >= SHIPS.length) {
      renderPlacementGrid(S.myBoard, null, null, null, S.horizontal);
      document.getElementById('btn-ready').disabled         = false;
      document.getElementById('placement-status').textContent = '✅ All ships placed! Press Ready when done.';
    } else {
      renderPlacementGrid(S.myBoard, SHIPS[S.placingIndex], S.hoverRow, S.hoverCol, S.horizontal);
    }
  };

  // Rotate button
  document.getElementById('btn-rotate').onclick = () => {
    S.horizontal = !S.horizontal;
    document.getElementById('orientation-label').textContent = S.horizontal ? 'Horizontal →' : 'Vertical ↓';
    if (S.placingIndex < SHIPS.length) {
      renderPlacementGrid(S.myBoard, SHIPS[S.placingIndex], S.hoverRow, S.hoverCol, S.horizontal);
    }
  };

  // R key shortcut
  document.onkeydown = (e) => {
    if ((e.key === 'r' || e.key === 'R') && S.phase === 'placing') {
      document.getElementById('btn-rotate').click();
    }
  };

  // Random placement
  document.getElementById('btn-random-place').onclick = () => {
    const result = randomPlaceAll();
    S.myBoard      = result.board;
    S.myShips      = result.ships;
    S.placingIndex = SHIPS.length;
    renderShipList(SHIPS.length);
    renderPlacementGrid(S.myBoard, null, null, null, S.horizontal);
    document.getElementById('btn-ready').disabled         = false;
    document.getElementById('placement-status').textContent = '✅ Ships placed randomly!';
  };

  // Clear
  document.getElementById('btn-clear-ships').onclick = () => {
    S.myBoard      = createEmptyBoard();
    S.myShips      = [];
    S.placingIndex = 0;
    document.getElementById('btn-ready').disabled         = true;
    document.getElementById('placement-status').textContent = '';
    renderShipList(0);
    renderPlacementGrid(S.myBoard, SHIPS[0], null, null, S.horizontal);
  };

  // Ready
  document.getElementById('btn-ready').onclick = handlePlayerReady;

  updateOpponentStatus();
}

function updateOpponentStatus() {
  const statusEl = document.getElementById('placement-opponent-status');
  if (!statusEl) return;
  statusEl.textContent = _opponentReady ? '✅ Opponent is ready!' : '⏳ Waiting for opponent to place ships…';
}

async function handlePlayerReady() {
  const btn = document.getElementById('btn-ready');
  btn.disabled    = true;
  btn.textContent = '⏳ Waiting for opponent…';
  document.getElementById('placement-status').textContent = '⏳ Waiting for opponent to finish…';

  await dbSaveBoard(S.roomId, S.playerId, S.myBoard, S.myShips);
  await rtBroadcast('ships_ready', { playerId: S.playerId });

  _myReady = true;
  if (_opponentReady) await transitionToBattle();
}

async function onOpponentShipsReady() {
  _opponentReady = true;
  updateOpponentStatus();
  if (_myReady) await transitionToBattle();
}

// ── BATTLE – transition ───────────────────────────────────────────────────────

async function transitionToBattle() {
  // Fetch both boards from DB
  const boards = await dbGetBoards(S.roomId);
  const myEntry      = boards.find(b => b.player_id === S.playerId);
  const opponentEntry = boards.find(b => b.player_id !== S.playerId);

  if (!myEntry || !opponentEntry) {
    setTimeout(transitionToBattle, 1500); // retry; DB may not be written yet
    return;
  }

  // Enemy real board used for local hit detection
  S.enemyRealBoard    = opponentEntry.board;
  // Display board: blank — we mark as shots are fired
  S.enemyDisplayBoard = createEmptyBoard();

  // Player 1 writes battle start to DB; both read current_turn from it
  if (S.playerNum === 1) {
    await dbStartBattle(S.roomId, S.playerId); // P1 goes first
  }

  // Small delay to ensure DB write is visible before read
  await new Promise(r => setTimeout(r, 600));

  const room    = await dbGetRoom(S.roomId);
  S.isMyTurn    = room.current_turn === S.playerId;
  S.phase       = 'battle';
  document.onkeydown = null; // remove placement key handler
  initBattleScreen();
}

async function rejoinBattle(room) {
  // Re-fetch all boards and reconstruct display state from move log
  const boards = await dbGetBoards(S.roomId);
  const opponentEntry = boards.find(b => b.player_id !== S.playerId);
  const myEntry       = boards.find(b => b.player_id === S.playerId);

  if (!opponentEntry || !myEntry) {
    alert('Could not restore game state. Please start a new game.');
    initHomeScreen();
    return;
  }

  S.enemyRealBoard    = opponentEntry.board;
  S.enemyDisplayBoard = createEmptyBoard();

  // Replay shots to rebuild display boards from game_moves log
  try {
    const moves = await dbGetMoves(S.roomId);

    if (moves) {
      moves.forEach(m => {
        if (m.player_id === S.playerId) {
          // Shot I fired – mark on enemy display board
          const cell = S.enemyRealBoard[m.row][m.col];
          S.enemyDisplayBoard[m.row][m.col] = { shipId: cell.shipId, hit: true };
        } else {
          // Shot fired at me – mark on my board
          S.myBoard = boards.find(b => b.player_id === S.playerId)?.board || createEmptyBoard();
        }
      });
    }
  } catch (_) {}

  if (!S.myBoard) S.myBoard = myEntry.board;

  S.isMyTurn = room.current_turn === S.playerId;
  S.phase    = 'battle';
  initBattleScreen();
}

// ── BATTLE – UI ───────────────────────────────────────────────────────────────

function initBattleScreen() {
  showScreen('battle');
  refreshBattleBoards();
  setTurnIndicator(S.isMyTurn);

  document.getElementById('rules-indicator').textContent =
    S.rules === 'classic'
      ? '⚓ Classic – hit again on a hit'
      : '🔄 Modern – turns always alternate';

  addBattleLog('Game started!', 'info');
  addBattleLog(S.isMyTurn ? 'You go first.' : 'Opponent goes first.', 'info');
}

function refreshBattleBoards() {
  renderGrid('my-board', S.myBoard, { showShips: true });
  renderEnemyGrid(
    'enemy-board',
    S.enemyDisplayBoard,
    S.isMyTurn,
    !S.isMyTurn,
    handleFire
  );
}

// ── BATTLE – firing ───────────────────────────────────────────────────────────

async function handleFire(row, col) {
  if (!S.isMyTurn) return;
  if (S.enemyDisplayBoard[row][col].hit) return; // already fired here

  // Run hit detection locally against the fetched enemy board
  const result = processShot(S.enemyRealBoard, row, col);
  if (result.alreadyFired) return;

  S.enemyRealBoard = result.board;

  // Update display board
  S.enemyDisplayBoard[row][col] = {
    shipId: result.hit ? S.enemyRealBoard[row][col].shipId : null,
    hit: true,
  };

  // Determine next turn
  let nextTurn;
  if (S.rules === 'classic' && result.hit && !result.gameOver) {
    nextTurn   = S.playerId;  // hit again!
    S.isMyTurn = true;
  } else {
    nextTurn   = S.opponentId;
    S.isMyTurn = false;
  }

  // Persist & broadcast
  await Promise.all([
    dbRecordMove(S.roomId, S.playerId, row, col, result.hit, result.shipSunk),
    rtBroadcast('move', {
      attackerId: S.playerId,
      row, col,
      hit:       result.hit,
      shipSunk:  result.shipSunk,
      gameOver:  result.gameOver,
      nextTurn,
    }),
  ]);

  if (!result.gameOver) {
    await dbUpdateTurn(S.roomId, nextTurn);
  }

  updateBattleUI(row, col, result, true);

  if (result.gameOver) {
    await dbUpdateRoomStatus(S.roomId, 'finished', S.playerId);
    await rtBroadcast('game_over', { winnerId: S.playerId });
    showGameOver(true);
  }
}

// ── BATTLE – incoming move ────────────────────────────────────────────────────

function onIncomingMove(payload) {
  const { row, col, hit, shipSunk, gameOver, nextTurn } = payload;

  // Mark the shot on my own board
  if (S.myBoard[row][col]) S.myBoard[row][col].hit = true;

  S.isMyTurn = (nextTurn === S.playerId);

  updateBattleUI(row, col, { hit, shipSunk, gameOver }, false);

  if (gameOver) showGameOver(false);
}

function updateBattleUI(row, col, result, iAttacked) {
  refreshBattleBoards();
  setTurnIndicator(S.isMyTurn);

  const coord = coordLabel(row, col);

  if (iAttacked) {
    if (result.shipSunk) {
      addBattleLog(`💥 You sunk their ${result.shipSunk} at ${coord}!`, 'sunk');
    } else if (result.hit) {
      addBattleLog(`🔥 Hit at ${coord}!${S.rules === 'classic' ? ' Fire again!' : ''}`, 'hit');
    } else {
      addBattleLog(`💧 Miss at ${coord}.`, 'miss');
    }
  } else {
    if (result.shipSunk) {
      addBattleLog(`💀 Opponent sunk your ${result.shipSunk} at ${coord}!`, 'sunk');
    } else if (result.hit) {
      addBattleLog(`🔥 Opponent hit at ${coord}!`, 'hit');
    } else {
      addBattleLog(`💧 Opponent missed at ${coord}.`, 'miss');
    }
  }
}

// ── GAME OVER ─────────────────────────────────────────────────────────────────

function onGameOver(payload) {
  showGameOver(payload.winnerId === S.playerId);
}

function showGameOver(won) {
  if (S.phase === 'gameover') return; // prevent double-trigger
  S.phase = 'gameover';
  rtUnsubscribe();
  showScreen('gameover');

  document.getElementById('gameover-result').innerHTML = won
    ? '<span class="win">🏆</span><p>You Win!<br><small>All enemy ships sunk.</small></p>'
    : '<span class="loss">💀</span><p>You Lose!<br><small>Your fleet was destroyed.</small></p>';

  document.getElementById('btn-play-again').onclick = () => {
    window.location.href = location.href.split('?')[0];
  };
}

// ── PRESENCE – opponent disconnected ─────────────────────────────────────────

function onPresenceLeave(leftPresences) {
  const opponentLeft = leftPresences.some(p => p.playerId === S.opponentId);
  if (!opponentLeft || S.phase === 'gameover') return;

  if (S.phase === 'battle') {
    addBattleLog('⚠️ Opponent disconnected. Waiting for reconnect…', 'info');
  }
}
