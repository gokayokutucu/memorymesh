# Importer Engine (Rust Prototype)

Rust-based prototype for high-performance GPT export scanning and extraction.

## Scope (R1)

This engine currently does:
- recursive folder scan
- `.json` file filtering
- JSON shape classification
- extraction of supported GPT conversation schema (`mapping` + `current_node`)
- deterministic main-path-only message ordering
- machine-readable JSON output to stdout

This engine does **not** do:
- database writes
- dedup/import policy decisions
- group chat import (`chats[]/messages[]` schema)

## Build

```bash
cd native/importer-engine
cargo build
```

## Run

```bash
cargo run -- /absolute/path/to/gpt-extraction
```

## Output Contract

The engine prints one JSON object to stdout:

- `scan_summary`
- `files[]`
  - `path`
  - `category`
  - `reason`
  - `conversations[]` (only for `supported_conversation_file`)

Conversation shape:
- `title`
- `source_conversation_id`
- `messages[]`
  - `id`
  - `role`
  - `content`
  - `content_type`
  - `create_time`
