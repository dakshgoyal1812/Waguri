-- Migration: 001_user_chat_isolation.sql
-- Description: Indexes for fast per-account conversation lookups and memory partitioning

CREATE INDEX IF NOT EXISTS conversations_user_started_idx ON conversations (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS memory_vectors_conversation_id_idx ON memory_vectors (conversation_id);
