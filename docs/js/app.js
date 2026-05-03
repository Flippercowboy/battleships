// ─────────────────────────────────────────────────────────────────────────────
// app.js  –  Main state machine & event handlers
// ─────────────────────────────────────────────────────────────────────────────

// ── Application state ─────────────────────────────────────────────────────────

const S = {
  playerId:   null,
  roomId:     null,
  roomCode:   null,
  playerNum:  null,   // 1 | 2  (null for host)
  rules:      'classic',
  opponentId: null,
  mode:       null,   // 'host' | 'player'
  phase:      'home', // home | lobby | spectator | placing | battle | gameover

  // Placement phase
  myBoard:          null,
  myShips:          [],
  placingIndex:     0,
  horizontal:       true,
  hoverRow:         null,
  hoverCol:         null,
  stagingRow:       null,
  stagingCol:       null,

  // Battle phase
  enemyRealBoard:    null,
  enemyDisplayBoard: null,
  isMyTurn:          false,

  // Spectator / host state
  specP1Id:          null,
  specP2Id:          null,
  specP1Board:       null,  // shots fired AT player 1
  specP2Board:       null,  // shots fired AT player 2
  specJoinedPlayers: null,
  specReadyCount:    0,
};

let _myReady             = false;
let _opponentReady       = false;
let _placementKeyHandler = null;  // stored so it can be properly removed
let _hoverRafPending     = false; // rAF gate for hover re-renders

// ── Kick off ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  S.playerId = getOrCreatePlayerId();

  const params   = new URLSearchParams(location.search);
  const joinCode = params.get('join');
  const after    = joinCode ? () => joinViaUrl(joinCode) : initHomeScreen;

  if (!getPlayerName()) {
    initNamePickerScreen(after);
  } else {
    after();
  }
});

// ── NAME PICKER ───────────────────────────────────────────────────────────────────────

function initNamePickerScreen(callback) {
  showScreen('namepick');
  document.querySelectorAll('.name-btn').forEach(btn => {
    btn.onclick = () => {
      setPlayerName(btn.dataset.name);
      callback();
    };
  });
}

// ── HOME ───────────────────────────────────────────────────────────────────────────

function initHomeScreen() {
  S.phase = 'home';
  S.mode  = null;
  showScreen('home');

  const name = getPlayerName();
  document.getElementById('home-player-name').textContent = '⚓ Playing as ' + name;

  document.querySelectorAll('.rule-card').forEach(card => {
    card.onclick = () => {
      document.querySelectorAll('.rule-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      S.rules = card.dataset.rules;
    };
  });

  document.getElementById('btn-host-game').onclick   = handleHostGame;
  document.getElementById('btn-join-game').onclick   = handlePlayerGame;
  document.getElementById('btn-leaderboard').onclick = initLeaderboardScreen;
  document.getElementById('btn-change-player').onclick = () => {
    localStorage.removeItem('bs_player_name');
    initNamePickerScreen(initHomeScreen);
  };
}

// ── LEADERBOARD ──────────────────────────────────────────────────────────────

async function initLeaderboardScreen() {
  showScreen('leaderboard');
  const tableEl = document.getElementById('leaderboard-table');
  tableEl.innerHTML = '<p class="lb-loading">Loading…</p>';

  try {
    const games   = await dbGetLeaderboard();
    const PLAYERS = ['Barney', 'Daddy', 'Mummy', 'Florrie'];
    const stats   = {};
    PLAYERS.forEach(p => { stats[p] = { wins: 0, played: 0 }; });

    games.forEach(g => {
      if (g.player1_name && stats[g.player1_name]) stats[g.player1_name].played++;
      if (g.player2_name && stats[g.player2_name]) stats[g.player2_name].played++;
      if (g.winner_name  && stats[g.winner_name])  stats[g.winner_name].wins++;
    });

    const EMOJIS = { Barney: '🧒', Daddy: '👨', Mummy: '👩', Florrie: '👧' };
    const MEDALS = ['🥇', '🥈', '🥉', ''];
    const myName = getPlayerName();

    const sorted = [...PLAYERS].sort((a, b) => {
      if (stats[b].wins !== stats[a].wins) return stats[b].wins - stats[a].wins;
      return stats[b].played - stats[a].played;
    });

    tableEl.innerHTML = sorted.map((name, i) => {
      const s   = stats[name];
      const pct = s.played ? Math.round(s.wins / s.played * 100) : 0;
      return `
        <div class="lb-row${name === myName ? ' lb-me' : ''}">
          <span class="lb-medal">${MEDALS[i] || ''}</span>
          <span class="lb-avatar">${EMOJIS[name]}</span>
          <span class="lb-name">${name}</span>
          <span class="lb-stat"><strong>${s.wins}</strong><small>wins</small></span>
          <span class="lb-stat"><strong>${s.played}</strong><small>played</small></span>
          <span class="lb-pct">${pct}%</span>
        </div>`;
    }).join('');

    if (games.length === 0) {
      tableEl.innerHTML += '<p class="lb-loading">No finished games yet — play one!</p>';
    }
  } catch (e) {
    tableEl.innerHTML = '<p class="lb-loading" style="color:var(--ship-hit)">Could not load leaderboard.</p>';
  }

  document.getElementById('btn-lb-back').onclick = initHomeScreen;
}

// ── HOST GAME (Laptop display) ─────────────────────────────────────────────────

async function handleHostGame() {
  const btn = document.getElementById('btn-host-game');
  btn.disabled    = true;
  btn.textContent = 'Creating\u2026';

  try {
    const room = await dbCreateRoom(S.rules);
    S.roomId             = room.id;
    S.roomCode           = room.room_code;
    S.mode               = 'host';
    S.specJoinedPlayers  = new Set();

    HANDLERS.onPlayerJoined  = onHostPlayerJoined;
    HANDLERS.onShipsReady    = onSpectatorShipsReady;
    HANDLERS.onMove          = onSpectatorMove;
    HANDLERS.onGameOver      = onSpectatorGameOver;
    HANDLERS.onPresenceLeave = onPresenceLeave;

    rtSubscribe(S.roomId);
    showLobby(room);

    // Poll fallback — catches joins that happen before subscribe completes
    const poll = setInterval(async () => {
      if (S.phase !== 'lobby') { clearInterval(poll); return; }
      try {
        const r = await dbGetRoom(S.roomId);
        let changed = false;
        if (r.player1_id && !S.specJoinedPlayers.has(r.player1_id)) {
          S.specJoinedPlayers.add(r.player1_id); changed = true;
        }
        if (r.player2_id && !S.specJoinedPlayers.has(r.player2_id)) {
          S.specJoinedPlayers.add(r.player2_id); changed = true;
        }
        if (changed) updateLobbyJoinCount(S.specJoinedPlayers.size);
        if (S.specJoinedPlayers.size >= 2) {
          clearInterval(poll);
          await initSpectatorScreen();
        }
      } catch (_) {}
    }, 3000);

  } catch (err) {
    alert(err.message);
    btn.disabled    = false;
    btn.textContent = 'Host Game';
  }
}

function showLobby(room) {
  S.phase = 'lobby';
  showScreen('lobby');
  generateQR(room.room_code);

  const badge = document.getElementById('rules-badge');
  badge.textContent = S.rules === 'classic'
    ? '\u2693 Classic Rules \u2013 hit again on a hit'
    : '\ud83d\udd04 Modern Rules \u2013 turns always alternate';

  updateLobbyJoinCount(0);
}

function updateLobbyJoinCount(count) {
  const el = document.getElementById('lobby-status');
  if (count === 0) {
    el.textContent = '\u23f3 Waiting for players to scan\u2026 (0 / 2)';
    el.className   = 'status-pill waiting';
  } else if (count === 1) {
    el.textContent = '\u2693 Player 1 joined! Waiting for Player 2\u2026 (1 / 2)';
    el.className   = 'status-pill waiting';
  } else {
    el.textContent = '\u2705 Both players joined! Starting\u2026';
    el.className   = 'status-pill ready';
  }
}

function onHostPlayerJoined(payload) {
  if (!S.specJoinedPlayers) S.specJoinedPlayers = new Set();
  S.specJoinedPlayers.add(payload.playerId);
  updateLobbyJoinCount(S.specJoinedPlayers.size);
  if (S.specJoinedPlayers.size >= 2) {
    setTimeout(initSpectatorScreen, 1000);
  }
}

// ── SPECTATOR SCREEN ──────────────────────────────────────────────────────────

async function initSpectatorScreen() {
  if (S.phase === 'spectator') return;
  S.phase = 'spectator';

  const room    = await dbGetRoom(S.roomId);
  S.specP1Id    = room.player1_id;
  S.specP2Id    = room.player2_id;
  S.specP1Board = createEmptyBoard();
  S.specP2Board = createEmptyBoard();
  S.specReadyCount = 0;

  HANDLERS.onShipsReady    = onSpectatorShipsReady;
  HANDLERS.onMove          = onSpectatorMove;
  HANDLERS.onGameOver      = onSpectatorGameOver;

  showScreen('spectator');
  renderSpectatorBoards();

  document.getElementById('spectator-status').textContent = '\u23f3 Waiting for both players to place ships\u2026';
  document.getElementById('spectator-turn').textContent   = '';
  document.getElementById('btn-spectator-new-game').style.display = 'none';
  document.getElementById('btn-spectator-new-game').onclick = () => {
    window.location.href = location.href.split('?')[0];
  };
}

function onSpectatorShipsReady(payload) {
  S.specReadyCount++;
  const label = payload.playerId === S.specP1Id ? 'Player 1' : 'Player 2';
  addSpectatorLog(label + ' placed their ships \u2713');
  const statusEl = document.getElementById('spectator-status');
  if (S.specReadyCount >= 2) {
    statusEl.textContent = '\u2694\ufe0f  Battle in progress!';
    // Fetch real ship boards so spectator can see both fleets
    dbGetBoards(S.roomId).then(boards => {
      const p1 = boards.find(b => b.player_id === S.specP1Id);
      const p2 = boards.find(b => b.player_id === S.specP2Id);
      if (p1) S.specP1Board = p1.board;
      if (p2) S.specP2Board = p2.board;
      renderSpectatorBoards();
    }).catch(() => {});
  } else {
    statusEl.textContent = '\u23f3 ' + label + ' is ready \u2013 waiting for other player\u2026';
  }
}

function onSpectatorMove(payload) {
  const { attackerId, row, col, hit, shipSunk, nextTurn } = payload;
  const isP1Attacking = (attackerId === S.specP1Id);
  const attackerLabel = isP1Attacking ? 'Player 1' : 'Player 2';
  const defenderLabel = isP1Attacking ? 'Player 2' : 'Player 1';

  // Mark shot — preserves ship data so spectator sees ships + hit/miss markers
  const defBoard = isP1Attacking ? S.specP2Board : S.specP1Board;
  if (defBoard && defBoard[row] && defBoard[row][col]) {
    defBoard[row][col].hit = true;
  }

  // Update turn indicator
  const turnLabel = (nextTurn === S.specP1Id) ? 'Player 1' : 'Player 2';
  const turnEl = document.getElementById('spectator-turn');
  turnEl.textContent = turnLabel + '\'s turn';
  turnEl.className   = 'turn-indicator ' + (turnLabel === 'Player 1' ? 'my-turn' : 'their-turn');

  const coord = coordLabel(row, col);
  if (shipSunk) {
    addSpectatorLog('\ud83d\udca5 ' + attackerLabel + ' sunk ' + defenderLabel + '\'s ' + shipSunk + ' at ' + coord + '!', 'sunk');
  } else if (hit) {
    addSpectatorLog('\ud83d\udd25 ' + attackerLabel + ' hit ' + defenderLabel + ' at ' + coord, 'hit');
  } else {
    addSpectatorLog('\ud83d\udca7 ' + attackerLabel + ' missed at ' + coord, 'miss');
  }
  renderSpectatorBoards();
}

function onSpectatorGameOver(payload) {
  const winnerLabel = (payload.winnerId === S.specP1Id) ? 'Player 1' : 'Player 2';
  document.getElementById('spectator-status').textContent = '\ud83c\udfc6 ' + winnerLabel + ' wins!';
  document.getElementById('spectator-turn').textContent   = 'Game over';
  addSpectatorLog('\ud83c\udfc6 ' + winnerLabel + ' wins the game!', 'sunk');
  document.getElementById('btn-spectator-new-game').style.display = 'inline-block';
}

function addSpectatorLog(msg, type) {
  const log   = document.getElementById('spectator-log');
  const entry = document.createElement('div');
  entry.className   = 'log-entry' + (type ? ' log-' + type : '');
  entry.textContent = msg;
  log.insertBefore(entry, log.firstChild);
  while (log.children.length > 15) log.removeChild(log.lastChild);
}

// ── PLAYER GAME (Play on this Device – creates room and plays as P1) ──────────

async function handlePlayerGame() {
  const btn = document.getElementById('btn-join-game');
  btn.disabled    = true;
  btn.textContent = 'Creating\u2026';

  try {
    const room = await dbCreateAndJoinRoom(S.rules);

    S.roomId    = room.id;
    S.roomCode  = room.room_code;
    S.playerNum = 1;
    S.rules     = room.rules;
    S.mode      = 'player';
    S.opponentId = null;

    HANDLERS.onPlayerJoined  = (payload) => {
      // P2 just joined — save their ID and move to placement
      if (!S.opponentId) S.opponentId = payload.playerId;
      updateLobbyJoinCount(2); // brief "Both joined!" flash
      setTimeout(initPlacementScreen, 800);
    };
    HANDLERS.onShipsReady    = onOpponentShipsReady;
    HANDLERS.onMove          = onIncomingMove;
    HANDLERS.onGameOver      = onGameOver;
    HANDLERS.onPresenceLeave = onPresenceLeave;

    rtSubscribe(S.roomId);

    // Show the lobby with QR code for P2 to scan
    S.phase = 'lobby';
    showScreen('lobby');
    document.getElementById('lobby-heading').textContent = 'Share this code with Player 2';
    generateQR(room.room_code);
    const badge = document.getElementById('rules-badge');
    badge.textContent = S.rules === 'classic'
      ? '\u2693 Classic Rules \u2013 hit again on a hit'
      : '\ud83d\udd04 Modern Rules \u2013 turns always alternate';
    updateLobbyJoinCount(1); // we are already player 1
    document.getElementById('lobby-status').textContent = '\u23f3 Waiting for Player 2 to scan\u2026';
    document.getElementById('lobby-status').className   = 'status-pill waiting';

    // Poll fallback in case the realtime broadcast is missed
    const poll = setInterval(async () => {
      if (S.phase !== 'lobby') { clearInterval(poll); return; }
      try {
        const r = await dbGetRoom(S.roomId);
        if (r.player2_id && !S.opponentId) {
          clearInterval(poll);
          S.opponentId = r.player2_id;
          updateLobbyJoinCount(2);
          setTimeout(initPlacementScreen, 800);
        }
      } catch (_) {}
    }, 3000);

  } catch (err) {
    btn.disabled    = false;
    btn.textContent = 'Play on this Device';
    alert(err.message);
  }
}

// ── JOIN SCREEN (manual code entry – kept for entering a friend's code) ───────

function initJoinScreen() {
  showScreen('join');
  const errEl = document.getElementById('join-error');
  const input = document.getElementById('join-code-input');
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

// ── JOIN via QR or manual code  –  used by BOTH players ──────────────────────

async function joinViaUrl(code) {
  const errEl = document.getElementById('join-error');
  try {
    const room = await dbJoinRoom(code);

    S.roomId    = room.id;
    S.roomCode  = room.room_code;
    S.playerNum = room._playerNum;
    S.rules     = room.rules;
    S.mode      = 'player';

    // Opponent ID: known immediately for P2, unknown for P1 until P2 broadcasts
    S.opponentId = (S.playerNum === 2) ? room.player1_id : (room.player2_id || null);

    HANDLERS.onPlayerJoined  = onOpponentJoined;
    HANDLERS.onShipsReady    = onOpponentShipsReady;
    HANDLERS.onMove          = onIncomingMove;
    HANDLERS.onGameOver      = onGameOver;
    HANDLERS.onPresenceLeave = onPresenceLeave;

    rtSubscribe(S.roomId);

    if (!room._rejoin) {
      await rtBroadcast('player_joined', { playerId: S.playerId, playerNum: S.playerNum });
    }

    if (room.status === 'battle' || room.status === 'finished') {
      await rejoinBattle(room);
      return;
    }

    // Check if opponent already marked ships_placed (P2 joining after P1 readied)
    if (S.opponentId) {
      const boards  = await dbGetBoards(S.roomId);
      const oppBoard = boards.find(b => b.player_id === S.opponentId);
      if (oppBoard && oppBoard.ships_placed) _opponentReady = true;
    }

    initPlacementScreen();

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

// Called when the other player broadcasts player_joined
function onOpponentJoined(payload) {
  if (!S.opponentId) S.opponentId = payload.playerId;
  if (S.phase === 'placing') updateOpponentStatus();
}

// ── SHIP PLACEMENT ────────────────────────────────────────────────────────────

function initPlacementScreen() {
  S.phase        = 'placing';
  S.myBoard      = createEmptyBoard();
  S.myShips      = [];
  S.placingIndex = 0;
  S.horizontal   = true;
  _myReady       = false;
  // _opponentReady preserved if set via DB check in joinViaUrl

  showScreen('placement');
  renderShipList(0);
  renderPlacementGrid(S.myBoard, SHIPS[0], null, null, true, false);
  updateOpponentStatus();
  document.getElementById('placement-status').textContent = 'Tap a cell to position your ' + SHIPS[0].name + '.';

  // ── Placement state ──────────────────────────────────────────────────────────
  // stagingRow/Col: the cell the player has selected but not yet confirmed.
  // null = nothing selected yet for this ship.
  S.stagingRow = null;
  S.stagingCol = null;

  const grid    = document.getElementById('placement-grid');
  const btnConfirm = document.getElementById('btn-confirm-place');

  // Single function: updates both the confirm button and the status hint together
  function updatePlacementUI() {
    if (S.placingIndex >= SHIPS.length) return;
    const statusEl = document.getElementById('placement-status');
    if (S.stagingRow === null) {
      btnConfirm.disabled    = true;
      btnConfirm.textContent = '\u2713 Place Ship';
      statusEl.textContent   = 'Tap a cell to position your ' + SHIPS[S.placingIndex].name + '.';
    } else {
      const valid = isValidPlacement(
        S.myBoard,
        getShipCells(S.stagingRow, S.stagingCol, SHIPS[S.placingIndex].size, S.horizontal)
      );
      btnConfirm.disabled    = !valid;
      btnConfirm.textContent = valid
        ? '\u2713 Place ' + SHIPS[S.placingIndex].name
        : '\u2713 Place Ship';
      statusEl.textContent = valid
        ? '\u2713 Press \u201cPlace ' + SHIPS[S.placingIndex].name + '\u201d to lock it in.'
        : '\u274c Invalid position \u2014 tap a different cell.';
    }
  }

  // Tap/click a cell: sets the staging position (no ship placed yet)
  grid.onclick = (e) => {
    const cell = e.target.closest('[data-row]');
    if (!cell || S.placingIndex >= SHIPS.length) return;
    S.stagingRow = +cell.dataset.row;
    S.stagingCol = +cell.dataset.col;
    renderPlacementGrid(S.myBoard, SHIPS[S.placingIndex], S.stagingRow, S.stagingCol, S.horizontal, true);
    updatePlacementUI();
  };

  // Mouse hover (desktop): only moves preview if nothing is staged yet
  grid.onmouseover = (e) => {
    if (S.stagingRow !== null) return;
    const cell = e.target.closest('[data-row]');
    if (!cell || S.placingIndex >= SHIPS.length) return;
    const r = +cell.dataset.row;
    const c = +cell.dataset.col;
    if (r === S.hoverRow && c === S.hoverCol) return; // no change, skip
    S.hoverRow = r;
    S.hoverCol = c;
    if (!_hoverRafPending) {
      _hoverRafPending = true;
      requestAnimationFrame(() => {
        _hoverRafPending = false;
        if (S.stagingRow === null && S.placingIndex < SHIPS.length) {
          renderPlacementGrid(S.myBoard, SHIPS[S.placingIndex], S.hoverRow, S.hoverCol, S.horizontal, false);
        }
      });
    }
  };

  grid.onmouseleave = () => {
    if (S.stagingRow !== null) return; // keep staged preview visible
    S.hoverRow = null;
    S.hoverCol = null;
    if (S.placingIndex < SHIPS.length) {
      renderPlacementGrid(S.myBoard, SHIPS[S.placingIndex], null, null, S.horizontal, false);
    }
  };

  // Confirm button: locks the staged ship onto the board
  btnConfirm.onclick = () => {
    if (S.stagingRow === null || S.placingIndex >= SHIPS.length) return;
    const result = placeShipOnBoard(S.myBoard, SHIPS[S.placingIndex], S.stagingRow, S.stagingCol, S.horizontal);
    if (!result) return;

    Audio.playPlace();
    S.myBoard = result.board;
    const placedCells = result.cells; // save before index advances
    S.myShips.push({ ...SHIPS[S.placingIndex], cells: result.cells, horizontal: S.horizontal, row: S.stagingRow, col: S.stagingCol });

    // Reset staging for next ship
    S.stagingRow = null;
    S.stagingCol = null;
    S.hoverRow   = null;
    S.hoverCol   = null;
    S.placingIndex++;

    renderShipList(S.placingIndex);

    if (S.placingIndex >= SHIPS.length) {
      renderPlacementGrid(S.myBoard, null, null, null, S.horizontal, false);
      btnConfirm.disabled    = true;
      btnConfirm.textContent = '\u2713 Place Ship';
      document.getElementById('btn-ready').disabled         = false;
      document.getElementById('placement-status').textContent = '\u2705 All ships placed! Press Ready when done.';
    } else {
      renderPlacementGrid(S.myBoard, SHIPS[S.placingIndex], null, null, S.horizontal, false);
      updatePlacementUI();
    }
    flashPlacedCells(placedCells); // flash AFTER grid re-render so elements exist
  };

  document.getElementById('btn-rotate').onclick = () => {
    S.horizontal = !S.horizontal;
    document.getElementById('orientation-label').textContent = S.horizontal ? 'Horizontal \u2192' : 'Vertical \u2193';
    if (S.placingIndex < SHIPS.length) {
      const isStaging  = S.stagingRow !== null;
      const previewRow = isStaging ? S.stagingRow : S.hoverRow;
      const previewCol = isStaging ? S.stagingCol : S.hoverCol;
      renderPlacementGrid(S.myBoard, SHIPS[S.placingIndex], previewRow, previewCol, S.horizontal, isStaging);
      updatePlacementUI();
    }
  };

  _placementKeyHandler = (e) => {
    if ((e.key === 'r' || e.key === 'R') && S.phase === 'placing') {
      document.getElementById('btn-rotate').click();
    }
  };
  document.addEventListener('keydown', _placementKeyHandler);

  document.getElementById('btn-random-place').onclick = () => {
    const result = randomPlaceAll();
    S.myBoard      = result.board;
    S.myShips      = result.ships;
    S.placingIndex = SHIPS.length;
    S.stagingRow   = null;
    S.stagingCol   = null;
    btnConfirm.disabled    = true;
    btnConfirm.textContent = '\u2713 Place Ship';
    renderShipList(SHIPS.length);
    renderPlacementGrid(S.myBoard, null, null, null, S.horizontal, false);
    document.getElementById('btn-ready').disabled         = false;
    document.getElementById('placement-status').textContent = '\u2705 Ships placed randomly!';
  };

  document.getElementById('btn-clear-ships').onclick = () => {
    S.myBoard      = createEmptyBoard();
    S.myShips      = [];
    S.placingIndex = 0;
    S.stagingRow   = null;
    S.stagingCol   = null;
    S.hoverRow     = null;
    S.hoverCol     = null;
    btnConfirm.disabled    = true;
    btnConfirm.textContent = '\u2713 Place Ship';
    document.getElementById('btn-ready').disabled         = true;
    document.getElementById('placement-status').textContent = 'Tap a cell to position your ' + SHIPS[0].name + '.';
    renderShipList(0);
    renderPlacementGrid(S.myBoard, SHIPS[0], null, null, S.horizontal, false);
  };

  document.getElementById('btn-ready').onclick = handlePlayerReady;
}

function updateOpponentStatus() {
  const statusEl = document.getElementById('placement-opponent-status');
  if (!statusEl) return;
  if (!S.opponentId) {
    statusEl.textContent = '\u23f3 Waiting for opponent to join\u2026';
  } else if (_opponentReady) {
    statusEl.textContent = '\u2705 Opponent is ready!';
  } else {
    statusEl.textContent = '\u23f3 Opponent is placing their ships\u2026';
  }
}

async function handlePlayerReady() {
  const btn = document.getElementById('btn-ready');
  btn.disabled    = true;
  btn.textContent = '\u23f3 Waiting for opponent\u2026';
  document.getElementById('placement-status').textContent = '\u23f3 Waiting for opponent to finish\u2026';

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
  const boards        = await dbGetBoards(S.roomId);
  const myEntry       = boards.find(b => b.player_id === S.playerId);
  const opponentEntry = boards.find(b => b.player_id !== S.playerId);

  if (!myEntry || !opponentEntry) {
    setTimeout(transitionToBattle, 1500);
    return;
  }

  S.enemyRealBoard    = opponentEntry.board;
  S.enemyDisplayBoard = createEmptyBoard();

  if (S.playerNum === 1) {
    await dbStartBattle(S.roomId, S.playerId);
  }

  // Poll until P1's dbStartBattle write is visible (avoids race where P2 reads null current_turn)
  let room;
  for (let i = 0; i < 15; i++) {
    room = await dbGetRoom(S.roomId);
    if (room.current_turn) break;
    await new Promise(r => setTimeout(r, 400));
  }
  S.isMyTurn = !!(room && room.current_turn === S.playerId);
  S.phase    = 'battle';
  if (_placementKeyHandler) {
    document.removeEventListener('keydown', _placementKeyHandler);
    _placementKeyHandler = null;
  }
  initBattleScreen();
}

async function rejoinBattle(room) {
  const boards        = await dbGetBoards(S.roomId);
  const opponentEntry = boards.find(b => b.player_id !== S.playerId);
  const myEntry       = boards.find(b => b.player_id === S.playerId);

  if (!opponentEntry || !myEntry) {
    alert('Could not restore game state. Please start a new game.');
    initHomeScreen();
    return;
  }

  S.enemyRealBoard    = opponentEntry.board;
  S.enemyDisplayBoard = createEmptyBoard();

  try {
    const moves = await dbGetMoves(S.roomId);
    moves.forEach(m => {
      if (m.player_id === S.playerId) {
        // My shots on the enemy board
        const cell = S.enemyRealBoard[m.row][m.col];
        S.enemyDisplayBoard[m.row][m.col] = { shipId: cell.shipId, hit: true };
      } else {
        // Opponent's shots on my board — restore hit markers
        if (S.myBoard[m.row] && S.myBoard[m.row][m.col]) {
          S.myBoard[m.row][m.col].hit = true;
        }
      }
    });
  } catch (_) {}

  S.myBoard  = myEntry.board;
  S.isMyTurn = (room.current_turn === S.playerId);
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
      ? '\u2693 Classic \u2013 hit again on a hit'
      : '\ud83d\udd04 Modern \u2013 turns always alternate';

  addBattleLog('Game started!', 'info');
  addBattleLog(S.isMyTurn ? 'You go first.' : 'Opponent goes first.', 'info');
}

function refreshBattleBoards() {
  renderGrid('my-board', S.myBoard, { showShips: true });
  renderEnemyGrid('enemy-board', S.enemyDisplayBoard, S.isMyTurn, !S.isMyTurn, handleFire);
}

// ── BATTLE – firing ───────────────────────────────────────────────────────────

async function handleFire(row, col) {
  if (!S.isMyTurn) return;
  if (S.enemyDisplayBoard[row][col].hit) return;

  const result = processShot(S.enemyRealBoard, row, col);
  if (result.alreadyFired) return;

  S.enemyRealBoard = result.board;
  S.enemyDisplayBoard[row][col] = {
    shipId: result.hit ? S.enemyRealBoard[row][col].shipId : null,
    hit: true,
  };

  let nextTurn;
  if (S.rules === 'classic' && result.hit && !result.gameOver) {
    nextTurn   = S.playerId;
    S.isMyTurn = true;
  } else {
    nextTurn   = S.opponentId;
    S.isMyTurn = false;
  }

  await Promise.all([
    dbRecordMove(S.roomId, S.playerId, row, col, result.hit, result.shipSunk),
    rtBroadcast('move', {
      attackerId: S.playerId, row, col,
      hit: result.hit, shipSunk: result.shipSunk,
      gameOver: result.gameOver, nextTurn,
    }),
  ]);

  if (!result.gameOver) await dbUpdateTurn(S.roomId, nextTurn);
  updateBattleUI(row, col, result, true);

  if (result.gameOver) {
    await dbUpdateRoomStatus(S.roomId, 'finished', S.playerId, getPlayerName());
    await rtBroadcast('game_over', { winnerId: S.playerId });
    showGameOver(true);
  }
}

// ── BATTLE – incoming move ────────────────────────────────────────────────────

function onIncomingMove(payload) {
  const { row, col, hit, shipSunk, gameOver, nextTurn } = payload;
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
    if (result.shipSunk)       { Audio.playSunk(); addBattleLog('\ud83d\udca5 You sunk their ' + result.shipSunk + ' at ' + coord + '!', 'sunk'); }
    else if (result.hit)       { Audio.playHit();  addBattleLog('\ud83d\udd25 Hit at ' + coord + '!' + (S.rules === 'classic' ? ' Fire again!' : ''), 'hit'); }
    else                       { Audio.playMiss(); addBattleLog('\ud83d\udca7 Miss at ' + coord + '.', 'miss'); }
  } else {
    if (result.shipSunk)       { Audio.playSunk(); addBattleLog('\ud83d\udc80 Opponent sunk your ' + result.shipSunk + ' at ' + coord + '!', 'sunk'); }
    else if (result.hit)       { Audio.playHit();  addBattleLog('\ud83d\udd25 Opponent hit at ' + coord + '!', 'hit'); }
    else                       { Audio.playMiss(); addBattleLog('\ud83d\udca7 Opponent missed at ' + coord + '.', 'miss'); }
  }
}

// ── GAME OVER ─────────────────────────────────────────────────────────────────

function onGameOver(payload) {
  showGameOver(payload.winnerId === S.playerId);
}

function showGameOver(won) {
  if (S.phase === 'gameover') return;
  S.phase = 'gameover';
  rtUnsubscribe();
  if (won) Audio.playWin(); else Audio.playLose();
  showScreen('gameover');

  document.getElementById('gameover-result').innerHTML = won
    ? '<span class="win">\ud83c\udfc6</span><p>You Win!<br><small>All enemy ships sunk.</small></p>'
    : '<span class="loss">\ud83d\udc80</span><p>You Lose!<br><small>Your fleet was destroyed.</small></p>';

  document.getElementById('btn-play-again').onclick = () => {
    window.location.href = location.href.split('?')[0];
  };
}

// ── PRESENCE – opponent disconnected ─────────────────────────────────────────

function onPresenceLeave(leftPresences) {
  const opponentLeft = leftPresences.some(p => p.playerId === S.opponentId);
  if (!opponentLeft || S.phase === 'gameover') return;
  if (S.phase === 'battle') {
    addBattleLog('\u26a0\ufe0f Opponent disconnected. Waiting for reconnect\u2026', 'info');
  }
}
