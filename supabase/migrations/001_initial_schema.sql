-- ─────────────────────────────────────────────────────────────────────────────
-- Battleships – Initial Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ─────────────────────────────────────────────────────────────────────────────

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";  -- available on Supabase Pro; see note below for free tier

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS game_rooms (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_code    TEXT UNIQUE NOT NULL,              -- 6-char code shared with Player 2
  status       TEXT NOT NULL DEFAULT 'waiting',  -- waiting | placing | battle | finished
  rules        TEXT NOT NULL DEFAULT 'classic',  -- classic | modern
  player1_id   TEXT,                             -- random UUID generated client-side
  player2_id   TEXT,
  current_turn TEXT,                             -- player_id of whose turn it is
  winner_id    TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_boards (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id      UUID REFERENCES game_rooms(id) ON DELETE CASCADE,
  player_id    TEXT NOT NULL,
  ships        JSONB NOT NULL DEFAULT '[]',      -- ship placement objects
  board        JSONB NOT NULL DEFAULT '[]',      -- 10×10 array of { shipId, hit }
  ships_placed BOOLEAN DEFAULT FALSE,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, player_id)
);

CREATE TABLE IF NOT EXISTS game_moves (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id    UUID REFERENCES game_rooms(id) ON DELETE CASCADE,
  player_id  TEXT NOT NULL,                     -- who fired
  row        INT NOT NULL CHECK (row BETWEEN 0 AND 9),
  col        INT NOT NULL CHECK (col BETWEEN 0 AND 9),
  hit        BOOLEAN NOT NULL,
  ship_sunk  TEXT,                              -- ship name if sunk, null otherwise
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE game_rooms  ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_moves  ENABLE ROW LEVEL SECURITY;

-- game_rooms – open read/insert/update for anon (room code acts as the join token)
CREATE POLICY "anon_select_rooms"  ON game_rooms FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_rooms"  ON game_rooms FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_rooms"  ON game_rooms FOR UPDATE TO anon USING (true);

-- game_boards – open for anon; ships are visible to both players after placement
-- (acceptable trade-off for a no-backend game; tighten with anon auth if desired)
CREATE POLICY "anon_select_boards" ON game_boards FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_boards" ON game_boards FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_boards" ON game_boards FOR UPDATE TO anon USING (true);

-- game_moves – append-only log, readable by both players
CREATE POLICY "anon_select_moves"  ON game_moves FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_moves"  ON game_moves FOR INSERT TO anon WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Realtime – enable Postgres Changes on game_rooms (for fallback polling)
-- ─────────────────────────────────────────────────────────────────────────────

-- In the Supabase dashboard you can also enable Realtime per-table under
-- Database → Replication → Supabase Realtime → game_rooms
ALTER PUBLICATION supabase_realtime ADD TABLE game_rooms;

-- ─────────────────────────────────────────────────────────────────────────────
-- Daily Cleanup via pg_cron  (Supabase Pro / pg_cron add-on required)
--
-- FREE TIER ALTERNATIVE: If pg_cron is unavailable, create a Supabase Edge
-- Function triggered by a cron schedule (Dashboard → Edge Functions → Schedule).
-- Use the SQL inside the $$ block as the function body via supabase-js.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT cron.schedule(
  'delete-old-game-rooms',
  '0 3 * * *',   -- 3:00 AM UTC every day
  $$
    DELETE FROM game_rooms
    WHERE created_at < now() - INTERVAL '24 hours';
    -- CASCADE deletes linked game_boards and game_moves automatically
  $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Optional: verify cron jobs
-- SELECT * FROM cron.job;
-- ─────────────────────────────────────────────────────────────────────────────
