// ─────────────────────────────────────────────────────────────────────────────
// realtime.js  –  Supabase Realtime channel management
//
// Uses a single long-lived channel per room.
// Events are dispatched through the mutable HANDLERS object defined in app.js.
// ─────────────────────────────────────────────────────────────────────────────

// HANDLERS is defined in app.js and populated as the game progresses.
// This allows us to update handlers without re-subscribing to the channel.
const HANDLERS = {};

let _channel = null;

function rtSubscribe(roomId) {
  if (_channel) {
    _sb.removeChannel(_channel);
    _channel = null;
  }

  _channel = _sb.channel(`game:${roomId}`, {
    config: { broadcast: { self: false } },
  });

  _channel
    .on('broadcast', { event: 'player_joined' }, ({ payload }) => {
      HANDLERS.onPlayerJoined && HANDLERS.onPlayerJoined(payload);
    })
    .on('broadcast', { event: 'ships_ready' }, ({ payload }) => {
      HANDLERS.onShipsReady && HANDLERS.onShipsReady(payload);
    })
    .on('broadcast', { event: 'move' }, ({ payload }) => {
      HANDLERS.onMove && HANDLERS.onMove(payload);
    })
    .on('broadcast', { event: 'game_over' }, ({ payload }) => {
      HANDLERS.onGameOver && HANDLERS.onGameOver(payload);
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      HANDLERS.onPresenceLeave && HANDLERS.onPresenceLeave(leftPresences);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await _channel.track({ playerId: getOrCreatePlayerId(), ts: Date.now() });
      }
    });
}

async function rtBroadcast(event, payload) {
  if (!_channel) return;
  try {
    await _channel.send({ type: 'broadcast', event, payload });
  } catch (e) {
    console.warn('rtBroadcast failed:', e);
  }
}

function rtUnsubscribe() {
  if (_channel) {
    _sb.removeChannel(_channel);
    _channel = null;
  }
}
