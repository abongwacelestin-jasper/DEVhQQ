-- Generic document store behind store/collection.ts.
-- Every persisted collection is one (collection, key) row with a JSONB body,
-- so feature lanes never write SQL for their own data.

CREATE TABLE documents (
  collection  text        NOT NULL,
  key         text        NOT NULL,
  data        jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, key),
  CONSTRAINT documents_collection_len CHECK (char_length(collection) BETWEEN 1 AND 100),
  CONSTRAINT documents_key_len        CHECK (char_length(key) BETWEEN 1 AND 512)
);

-- Containment queries over row bodies (data @> '{"status":"open"}').
CREATE INDEX documents_data_gin ON documents USING gin (data jsonb_path_ops);

-- Hydration and bounded windows: newest rows of one collection first.
CREATE INDEX documents_collection_updated_at ON documents (collection, updated_at DESC);
