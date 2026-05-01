// ─────────────────────────────────────────────────────────────────────────────
// db.js  –  Supabase client + all database operations
// ─────────────────────────────────────────────────────────────────────────────

const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Player identity (persisted in sessionStorage) ─────────────────────────────

function getOrCreatePlayerId() {
  let id = sessionStorage.getItem('bs_player_id');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('bs_player_id', id);
  }
  return id;
}

// ── Room operations ───────────────────────────────────────────────────────────

async function dbCreateRoom(rules) {
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const playerId = getOrCreatePlayerId();

  const { data, error } = await _sb
    .from('game_rooms')
    .insert({ room_code: roomCode, rules, player1_id: playerId, status: 'waiting' })
    .select()
    .single();

  if (error) throw new Error('Could not create room: ' + error.message);
  return data;
}

async function dbJoinRoom(roomCode) {
  const playerId = getOrCreatePlayerId();
  const code = roomCode.toUpperCase().trim();

  const { data: room, error: fetchErr } = await _sb
    .from('game_rooms')
    .select('*')
    .eq('room_code', code)
    .maybeSingle();

  if (fetchErr) throw new Error('Database error: ' + fetchErr.message);
  if (!room)    throw new Error('Room not found. Check the code and try again.');

  // Handle rejoin (same player refreshing)
  if (room.player1_id === playerId) {
    return { ...room, _playerNum: 1, _rejoin: true };
  }
  if (room.player2_id === playerId) {
    return { ...room, _playerNum: 2, _rejoin: true };
  }

  if (room.player2_id)             throw new Error('Room is already full.');
  if (room.status !== 'waiting')   throw new Error('Game has already started.');

  const { data: updated, error: updateErr } = await _sb
    .from('game_rooms')
    .update({ player2_id: playerId, status: 'placing', updated_at: new Date().toISOString() })
    .eq('id', room.id)
    .select()
    .single();

  if (updateErr) throw new Error('Could not join room: ' + updateErr.message);
  return { ...updated, _playerNum: 2, _rejoin: false };
}

async function dbGetRoom(roomId) {
  const { data, error } = await _sb
    .from('game_rooms')
    .select('*')
    .eq('id', roomId)
    .single();
  if (error) throw new Error('Could not fetch room: ' + error.message);
  return data;
}

async function dbUpdateRoomStatus(roomId, status, winnerId = null) {
  const updates = { status, updated_at: new Date().toISOString() };
  if (winnerId) updates.winner_id = winnerId;
  const { error } = await _sb.from('game_rooms').update(updates).eq('id', roomId);
  if (error) console.error('updateRoomStatus:', error.message);
}

async function dbStartBattle(roomId, firstPlayerId) {
  const { error } = await _sb
    .from('game_rooms')
    .update({ status: 'battle', current_turn: firstPlayerId, updated_at: new Date().toISOString() })
    .eq('id', roomId);
  if (error) console.error('startBattle:', error.message);
}

async function dbUpdateTurn(roomId, nextPlayerId) {
  const { error } = await _sb
    .from('game_rooms')
    .update({ current_turn: nextPlayerId, updated_at: new Date().toISOString() })
    .eq('id', roomId);
  if (error) console.error('updateTurn:', error.message);
}

// ── Board operations ──────────────────────────────────────────────────────────

async function dbSaveBoard(roomId, playerId, board, ships) {
  const { error } = await _sb
    .from('game_boards')
    .upsert(
      { room_id: roomId, player_id: playerId, board, ships, ships_placed: true, updated_at: new Date().toISOString() },
      { onConflict: 'room_id,player_id' }
    );
  if (error) throw new Error('Could not save board: ' + error.message);
}

async function dbGetBoards(roomId) {
  const { data, error } = await _sb
    .from('game_boards')
    .select('*')
    .eq('room_id', roomId);
  if (error) throw new Error('Could not fetch boards: ' + error.message);
  return data || [];
}

// ── Move log ──────────────────────────────────────────────────────────────────

async function dbGetMoves(roomId) {
  const { data, error } = await _sb
    .from('game_moves')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  if (error) throw new Error('Could not fetch moves: ' + error.message);
  return data || [];
}

async function dbRecordMove(roomId, playerId, row, col, hit, shipSunk) {
  const { error } = await _sb
    .from('game_moves')
    .insert({ room_id: roomId, player_id: playerId, row, col, hit, ship_sunk: shipSunk || null });
  if (error) console.error('recordMove:', error.message);
}
