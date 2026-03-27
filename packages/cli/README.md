# MemoryMesh CLI (`memorymesh`)

MemoryMesh CLI provides:

- first-run interactive installer for local MemoryMesh runtime
- managed Docker stack lifecycle (`start/stop/reset/uninstall`)
- doctor diagnostics and safe repairs (`doctor --fix`)
- Claude Desktop MCP integration
- import tools (`import:gpt`)

## Usage

```bash
npm install -g memorymesh
memorymesh
```

Release stack notes:

- installer-managed compose lives at `~/.memorymesh/stack/docker-compose.yml`
- default server image is `ghcr.io/memorymesh/server:latest`
- override with `MEMORYMESH_SERVER_IMAGE=...` when running `memorymesh start` or setup

## Embedding Configuration

Authoritative embedding configuration lives in:

- `~/.memorymesh/config.json`

Generated execution artifact:

- `~/.memorymesh/runtime.env` (derived from `config.json`, regenerated on drift)

Supported user flow:

- Re-run `memorymesh` setup to change embedding mode/model
- Avoid manual embedding env overrides in normal usage

Interactive defaults:

- project: `MemoryMesh`
- mode: `real import`
- engine: `rust`
- import policy: `skip_existing`
- verbose: `false`
- delay: `0`

To force interactive dry-run mode:

```bash
MEMORYMESH_INTERACTIVE_DRY_RUN=true memorymesh
```

Direct command mode:

```bash
memorymesh import:gpt --path <file-or-folder> [options]
```

Alias:

```bash
memorymesh import:gpt --file <file-or-folder> [options]
```

Development script alias remains available:

```bash
npm run -w memorymesh import:gpt -- --path <file-or-folder> [options]
```

## Output Behavior

- Default mode is quiet.
- Quiet output shows only:
  - conversation-level progress bar
  - final summary
- `--verbose` enables detailed per-message dry-run/import logs (`IMPORT/SKIP` with previews).

This default is intentional for large exports where message-level logging can be very noisy.

## Progress Bars

During import or dry-run, the CLI renders three compact progress bars:

```text
[overall ] [██████████░░░░░░░░░░░░░░] completed files 3/13 | completed conv 24/97 | ETA 00:41
[file    ] [████████████░░░░░░░░░░░░] conversations-002.json | conv 24/41
[message ] [██████░░░░░░░░░░░░░░░░░░] 42/187 msg | stage=embedding | ETA 00:12
```

The CLI also prints:

```text
Running conversation file 3/13: conversations-002.json
```

This keeps run-level and file-level progress visible without flooding output.

## Scan Summary Table

Scan results are printed as a deterministic ASCII table:

```text
+---------------------------------+-------+
| Scan Summary                    | Count |
+---------------------------------+-------+
| Scanned JSON files              | 19    |
| Supported conversation files    | 13    |
| Unsupported conversation schema | 1     |
| Ignorable JSON                  | 5     |
| Unknown JSON                    | 0     |
| Invalid JSON                    | 0     |
+---------------------------------+-------+
```

## Import Policies

Supported policies:

- `skip_existing` (default): if the same `ref_id` already exists, skip import.
- `import_anyway`: import even when duplicates exist.
- `overwrite_existing`: not implemented across all stores yet; currently results in skip reason:
  - `overwrite_existing_not_supported`

`overwrite_existing` is intentionally explicit and not treated as a true overwrite operation yet.

## Import Audit Log

Importer runs can write a persistent JSON Lines audit log (`.jsonl`) with one structured event per line.

Default policy:

- real import: audit enabled
- dry-run: audit disabled

Environment configuration:

```bash
MEMORYMESH_IMPORT_AUDIT_ENABLED=true
MEMORYMESH_IMPORT_AUDIT_DIR=/path/to/audit-dir
```

Default directory (if not overridden):

```text
~/.memorymesh/import-audit/
```

Typical event types:

- run lifecycle: `run_started`, `run_completed`, `run_failed`
- scan lifecycle: `scan_started`, `scan_completed`
- file lifecycle: `file_started`, `file_completed`
- conversation lifecycle: `conversation_started`, `conversation_completed`
- message lifecycle: `message_imported`, `message_skipped`, `message_stage_changed`
- checkpoint lifecycle: `checkpoint_loaded`, `checkpoint_advanced`, `checkpoint_reset`

At the end of a run, CLI prints:

```text
Audit log written to: <path>
```

## Resume Behavior and Safe Re-runs

MemoryMesh GPT imports are designed to behave like a resume-friendly import flow when re-running the same dataset.

This works because imported messages use a deterministic `ref_id`, and the default import policy is `skip_existing`.

When the same export is imported again, the importer checks whether each message already exists and skips previously imported items.

### Conditions for resume-like behavior

Resume-like behavior depends on the following conditions:

1. **Same project**
   Re-run the import using the same `project` value.

2. **Same deterministic `ref_id` strategy**
   The same source conversation/message must produce the same `ref_id`.

3. **Default import policy: `skip_existing`**
   This is the recommended mode for safe resume behavior.

4. **`import_anyway` disables resume-style dedup**
   If you use `import_anyway`, duplicate records may be created.

5. **`overwrite_existing` is not currently supported**
   This mode is not implemented across all stores and currently results in:
   `overwrite_existing_not_supported`

### Resume settle delay

MemoryMesh may wait briefly before beginning the import phase in order to reduce race conditions after a previously interrupted run.

Why this exists:
Some persistence steps may still be completing in the background when a failed/interrupted import is restarted immediately.

Behavior:
- If scan/extraction already takes long enough, no extra wait is added.
- If the preparation phase is too short, MemoryMesh can wait for the remaining time up to a configured minimum settle window.

This does not provide a strict transactional guarantee, but it reduces the likelihood of duplicate imports during rapid re-runs.

### Transactional checkpointing

The importer now uses local message-level checkpoint files by default.

- A checkpoint is keyed by input path + project + engine + import policy.
- Checkpoint state is mode-isolated:
  - dry-run uses `gpt-import-dry-run-...json`
  - real import uses `gpt-import-real-...json`
- Dry-run checkpoint progress never affects real import resume behavior.
- Progress advances only after a message is safely processed:
  - imported successfully, or
  - skipped with deterministic reasons (for example `duplicate_ref_id`, `payload_too_large`, `unsupported_role:*`).
- On re-run, the importer resumes from the last checkpointed position and skips already committed messages.

Checkpointing works together with dedup:

- checkpoint = primary local resume cursor
- deterministic `ref_id` + `skip_existing` = secondary safety net

### Long content embedding guard

Long memory content is embedded with automatic chunking and mean pooling.

- short content: single-pass embedding
- long content: chunked embedding + averaged vector aggregation

If embedding still cannot be produced after chunk fallback, the importer records a stable failure reason:

- `embedding_input_too_large`

## Engine Selection

- `--engine ts` (default): TypeScript scanner/parser path.
- `--engine rust`: Rust extraction engine path (scanner/classifier/parser in Rust).

When using Rust engine:

- Build the binary first:

```bash
cargo build --manifest-path native/importer-engine/Cargo.toml
```

- Optional explicit binary path:

```bash
--rust-bin /absolute/path/to/importer-engine
```

### Import Gateway Mode

The GPT importer supports two gateway modes.

#### Default (recommended)

```bash
MEMORYMESH_IMPORT_GATEWAY_MODE=local
```

Uses the **direct runtime gateway**.

CLI writes memories **directly through the shared runtime engine** without using MCP HTTP.

Advantages:

- faster
- no network dependency
- no MCP transport overhead
- suitable for large imports

#### Remote mode

```bash
MEMORYMESH_IMPORT_GATEWAY_MODE=remote
```

CLI sends requests through the MCP server using the `save_memory` tool.

This mode exists mainly for:

- remote deployments
- debugging MCP behavior
- testing tool compatibility

## Command Examples

```bash
# dry-run on a folder (quiet default)
memorymesh import:gpt \
  --path ~/Downloads/gpt-extraction \
  --project MemoryMesh \
  --dry-run

# real import on a folder
memorymesh import:gpt \
  --path ~/Downloads/gpt-extraction \
  --project MemoryMesh

# rust engine dry-run
memorymesh import:gpt \
  --path ~/Downloads/gpt-extraction \
  --project MemoryMesh \
  --dry-run \
  --engine rust

# verbose dry-run with no pacing delay
memorymesh import:gpt \
  --path ~/Downloads/gpt-extraction \
  --project MemoryMesh \
  --dry-run \
  --verbose \
  --delay-ms 0

# import only first 10 conversations
memorymesh import:gpt \
  --path ~/Downloads/gpt-extraction \
  --project MemoryMesh \
  --limit 10
```

## Options

| Option | Description |
|---|---|
| `--path <file-or-folder>` | Input file or directory to import (recursive scan for folders). |
| `--file <file-or-folder>` | Alias for `--path`. |
| `--project <name>` | Target MemoryMesh project name. |
| `--dry-run` | Evaluate and report without writing memories. |
| `--delay-ms <n>` | Delay between conversations in milliseconds. Default: `3000`. |
| `--verbose` | Show detailed per-message dry-run/import logs. |
| `--engine <ts\|rust>` | Select extraction engine. Default: `ts`. |
| `--rust-bin <path>` | Optional explicit Rust engine binary path. |
| `--import-policy <skip_existing\|overwrite_existing\|import_anyway>` | Dedup/import policy. Default: `skip_existing`. |
| `--limit <n>` | Import only first `n` conversations after scan/classification. |
| `--no-checkpoint` | Disable checkpoint load/save for the current run. |
| `--reset-checkpoint` | Reset checkpoint state before starting the import. |
