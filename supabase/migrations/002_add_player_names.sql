-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 – Add player name columns for leaderboard
-- Run this in your Supabase SQL Editor after 001_initial_schema.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS player1_name TEXT;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS player2_name TEXT;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS winner_name  TEXT;
