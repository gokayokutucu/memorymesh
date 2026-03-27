use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum JsonFileCategory {
    SupportedConversationFile,
    UnsupportedConversationSchema,
    IgnorableJson,
    UnknownJson,
    InvalidJson,
}

#[derive(Debug, Serialize)]
struct ScanSummary {
    scanned_json_files: usize,
    supported_conversation_file: usize,
    unsupported_conversation_schema: usize,
    ignorable_json: usize,
    unknown_json: usize,
    invalid_json: usize,
}

impl ScanSummary {
    fn new(scanned_json_files: usize) -> Self {
        Self {
            scanned_json_files,
            supported_conversation_file: 0,
            unsupported_conversation_schema: 0,
            ignorable_json: 0,
            unknown_json: 0,
            invalid_json: 0,
        }
    }

    fn bump(&mut self, category: JsonFileCategory) {
        match category {
            JsonFileCategory::SupportedConversationFile => self.supported_conversation_file += 1,
            JsonFileCategory::UnsupportedConversationSchema => {
                self.unsupported_conversation_schema += 1
            }
            JsonFileCategory::IgnorableJson => self.ignorable_json += 1,
            JsonFileCategory::UnknownJson => self.unknown_json += 1,
            JsonFileCategory::InvalidJson => self.invalid_json += 1,
        }
    }
}

#[derive(Debug, Serialize)]
struct EngineOutput {
    scan_summary: ScanSummary,
    files: Vec<FileResult>,
}

#[derive(Debug, Serialize)]
struct FileResult {
    path: String,
    category: JsonFileCategory,
    reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    conversations: Option<Vec<Conversation>>,
}

#[derive(Debug, Serialize)]
struct Conversation {
    title: String,
    source_conversation_id: Option<String>,
    messages: Vec<Message>,
}

#[derive(Debug, Serialize)]
struct Message {
    id: String,
    role: String,
    content: String,
    content_type: Option<String>,
    create_time: Option<f64>,
}

#[derive(Debug)]
struct Node {
    id: String,
    parent: Option<String>,
    children: Vec<String>,
    message: Option<Value>,
}

fn main() {
    let mut args = env::args();
    let _bin = args.next();
    let Some(first_arg) = args.next() else {
        eprintln!("Usage: importer-engine <path>");
        std::process::exit(1);
    };

    if first_arg == "documents" {
        let Some(input_path) = args.next() else {
            eprintln!("Usage: importer-engine documents <path> [limits_json]");
            std::process::exit(1);
        };
        let limits_json = args.next();
        run_document_mode(&input_path, limits_json.as_deref());
        return;
    }

    let input_path = first_arg;

    let mut json_files = Vec::new();
    collect_json_files(Path::new(&input_path), &mut json_files);
    json_files.sort();

    let mut summary = ScanSummary::new(json_files.len());
    let mut files = Vec::new();

    for file in json_files {
        let path_str = file.to_string_lossy().to_string();

        let content = match fs::read_to_string(&file) {
            Ok(content) => content,
            Err(_) => {
                summary.bump(JsonFileCategory::InvalidJson);
                files.push(FileResult {
                    path: path_str,
                    category: JsonFileCategory::InvalidJson,
                    reason: "invalid_json_read_error".to_string(),
                    conversations: None,
                });
                continue;
            }
        };

        let parsed = match serde_json::from_str::<Value>(&content) {
            Ok(value) => value,
            Err(_) => {
                summary.bump(JsonFileCategory::InvalidJson);
                files.push(FileResult {
                    path: path_str,
                    category: JsonFileCategory::InvalidJson,
                    reason: "invalid_json_parse_error".to_string(),
                    conversations: None,
                });
                continue;
            }
        };

        let (category, reason) = classify_json_shape(&parsed);
        summary.bump(category);

        let conversations = if matches!(category, JsonFileCategory::SupportedConversationFile) {
            Some(extract_supported_conversations(&parsed))
        } else {
            None
        };

        files.push(FileResult {
            path: path_str,
            category,
            reason: reason.to_string(),
            conversations,
        });
    }

    let output = EngineOutput {
        scan_summary: summary,
        files,
    };

    match serde_json::to_string_pretty(&output) {
        Ok(json) => {
            let mut stdout = io::stdout().lock();
            if let Err(err) = stdout.write_all(json.as_bytes()) {
                // Broken pipe is expected when output is truncated by tools like `head`.
                if err.kind() != io::ErrorKind::BrokenPipe {
                    eprintln!("Failed to write output JSON: {err}");
                    std::process::exit(1);
                }
            }
            let _ = stdout.write_all(b"\n");
        }
        Err(err) => {
            eprintln!("Failed to serialize output JSON: {err}");
            std::process::exit(1);
        }
    }
}

// Recursive folder walker with .json filtering only.
fn collect_json_files(path: &Path, out: &mut Vec<PathBuf>) {
    if path.is_file() {
        if has_json_extension(path) {
            out.push(path.to_path_buf());
        }
        return;
    }

    let read_dir = match fs::read_dir(path) {
        Ok(dir) => dir,
        Err(_) => return,
    };

    for entry_result in read_dir {
        let Ok(entry) = entry_result else {
            continue;
        };
        let child = entry.path();
        if child.is_dir() {
            collect_json_files(&child, out);
        } else if child.is_file() && has_json_extension(&child) {
            out.push(child);
        }
    }
}

fn has_json_extension(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some(ext) if ext.eq_ignore_ascii_case("json")
    )
}

// Shape-based classifier used by Phase R1.
fn classify_json_shape(parsed: &Value) -> (JsonFileCategory, &'static str) {
    if is_supported_conversation_schema(parsed) {
        return (
            JsonFileCategory::SupportedConversationFile,
            "array_with_mapping_and_current_node",
        );
    }

    if is_unsupported_group_chat_schema(parsed) {
        return (
            JsonFileCategory::UnsupportedConversationSchema,
            "group_chats_schema_not_supported_in_phase",
        );
    }

    if is_ignorable_metadata_shape(parsed) {
        return (JsonFileCategory::IgnorableJson, "metadata_or_support_json");
    }

    (JsonFileCategory::UnknownJson, "unknown_json_shape")
}

fn is_supported_conversation_schema(parsed: &Value) -> bool {
    let Some(items) = parsed.as_array() else {
        return false;
    };

    if items.is_empty() {
        return false;
    }

    items.iter().any(|item| {
        let Some(object) = item.as_object() else {
            return false;
        };

        let has_current_node = matches!(
            object.get("current_node"),
            Some(Value::String(_)) | Some(Value::Number(_)) | Some(Value::Null)
        );

        has_current_node
            && object
                .get("mapping")
                .and_then(Value::as_object)
                .is_some()
    })
}

fn is_unsupported_group_chat_schema(parsed: &Value) -> bool {
    let Some(object) = parsed.as_object() else {
        return false;
    };

    let Some(chats) = object.get("chats").and_then(Value::as_array) else {
        return false;
    };

    chats
        .iter()
        .any(|chat| chat.as_object().and_then(|obj| obj.get("messages").and_then(Value::as_array)).is_some())
}

fn is_ignorable_metadata_shape(parsed: &Value) -> bool {
    if let Some(object) = parsed.as_object() {
        let keys: BTreeSet<&str> = object.keys().map(String::as_str).collect();

        if intersects(
            &keys,
            &[
                "manifest",
                "exported_at",
                "user_profile",
                "settings",
                "feedback",
                "shared_conversations",
            ],
        ) {
            return true;
        }

        if contains_all(&keys, &["export_files", "logical_files", "manifest_file"]) {
            return true;
        }

        if contains_all(&keys, &["id", "email"]) {
            return true;
        }
    }

    if let Some(array) = parsed.as_array() {
        if let Some(first) = array.first().and_then(Value::as_object) {
            let keys: BTreeSet<&str> = first.keys().map(String::as_str).collect();

            if contains_all(&keys, &["conversation_id", "title", "is_anonymous"]) {
                return true;
            }

            if contains_all(&keys, &["evaluation_name", "rating", "conversation_id"]) {
                return true;
            }

            if contains_all(&keys, &["user_id", "settings"]) {
                return true;
            }
        }
    }

    false
}

fn intersects(keys: &BTreeSet<&str>, expected: &[&str]) -> bool {
    expected.iter().any(|key| keys.contains(key))
}

fn contains_all(keys: &BTreeSet<&str>, expected: &[&str]) -> bool {
    expected.iter().all(|key| keys.contains(key))
}

fn extract_supported_conversations(parsed: &Value) -> Vec<Conversation> {
    let Some(items) = parsed.as_array() else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(extract_conversation)
        .collect::<Vec<_>>()
}

fn extract_conversation(item: &Value) -> Option<Conversation> {
    let object = item.as_object()?;

    let mapping_object = object.get("mapping")?.as_object()?;
    let title = object
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Untitled")
        .to_string();

    let source_conversation_id = object
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            object
                .get("conversation_id")
                .and_then(Value::as_str)
                .map(str::to_string)
        });

    let nodes = normalize_mapping_nodes(mapping_object);
    if nodes.is_empty() {
        return None;
    }

    let ordered_ids = reconstruct_main_path(&nodes, object.get("current_node"));
    let messages = ordered_ids
        .iter()
        .filter_map(|id| nodes.get(id))
        .filter_map(node_to_message)
        .collect::<Vec<_>>();

    Some(Conversation {
        title,
        source_conversation_id,
        messages,
    })
}

fn normalize_mapping_nodes(mapping: &Map<String, Value>) -> HashMap<String, Node> {
    let mut nodes = HashMap::new();

    for (id, raw_node) in mapping {
        let Some(node_obj) = raw_node.as_object() else {
            continue;
        };

        let parent = match node_obj.get("parent") {
            Some(Value::String(parent)) => Some(parent.clone()),
            _ => None,
        };

        let mut children = node_obj
            .get("children")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        children.sort();

        let message = node_obj.get("message").cloned();

        nodes.insert(
            id.clone(),
            Node {
                id: id.clone(),
                parent,
                children,
                message,
            },
        );
    }

    nodes
}

// Deterministic main-path-only traversal.
fn reconstruct_main_path(nodes: &HashMap<String, Node>, current_node: Option<&Value>) -> Vec<String> {
    if let Some(chain) = reconstruct_from_current(nodes, current_node) {
        return chain;
    }

    reconstruct_from_root(nodes)
}

fn reconstruct_from_current(
    nodes: &HashMap<String, Node>,
    current_node: Option<&Value>,
) -> Option<Vec<String>> {
    let current_id = match current_node {
        Some(Value::String(id)) => id,
        Some(Value::Number(number)) => {
            let id = number.to_string();
            return follow_parent_chain(nodes, &id);
        }
        _ => return None,
    };

    follow_parent_chain(nodes, current_id)
}

fn follow_parent_chain(nodes: &HashMap<String, Node>, start: &str) -> Option<Vec<String>> {
    if !nodes.contains_key(start) {
        return None;
    }

    let mut chain = Vec::new();
    let mut cursor = start.to_string();
    let mut visited = HashSet::new();

    loop {
        if !visited.insert(cursor.clone()) {
            break;
        }

        let node = nodes.get(&cursor)?;
        chain.push(node.id.clone());

        match &node.parent {
            Some(parent) if nodes.contains_key(parent) => {
                cursor = parent.clone();
            }
            _ => break,
        }
    }

    chain.reverse();
    Some(chain)
}

fn reconstruct_from_root(nodes: &HashMap<String, Node>) -> Vec<String> {
    let mut roots = nodes
        .values()
        .filter(|node| match &node.parent {
            None => true,
            Some(parent) => !nodes.contains_key(parent),
        })
        .map(|node| node.id.clone())
        .collect::<Vec<_>>();

    roots.sort();

    let Some(mut cursor) = roots.first().cloned() else {
        return Vec::new();
    };

    let mut ordered = Vec::new();
    let mut visited = HashSet::new();

    loop {
        if !visited.insert(cursor.clone()) {
            break;
        }

        let Some(node) = nodes.get(&cursor) else {
            break;
        };

        ordered.push(node.id.clone());

        let next_child = node
            .children
            .iter()
            .find(|child| nodes.contains_key(*child) && !visited.contains(*child))
            .cloned();

        match next_child {
            Some(next) => cursor = next,
            None => break,
        }
    }

    ordered
}

fn node_to_message(node: &Node) -> Option<Message> {
    let message_obj = node.message.as_ref()?.as_object()?;

    let role = message_obj
        .get("author")
        .and_then(Value::as_object)
        .and_then(|author| author.get("role"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    let content_obj = message_obj.get("content").and_then(Value::as_object)?;

    let content_type = content_obj
        .get("content_type")
        .and_then(Value::as_str)
        .map(str::to_string);

    let content = content_obj
        .get("parts")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string()
        })
        .unwrap_or_default();

    if content.is_empty() {
        return None;
    }

    let create_time = message_obj.get("create_time").and_then(Value::as_f64);

    let id = message_obj
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| node.id.clone());

    Some(Message {
        id,
        role,
        content,
        content_type,
        create_time,
    })
}

#[derive(Debug, Clone, Deserialize)]
struct DocumentImportLimits {
    max_file_size_mb: usize,
    max_chars_per_file: usize,
    max_chunks_per_file: usize,
    chunk_size: usize,
    chunk_overlap: usize,
}

impl Default for DocumentImportLimits {
    fn default() -> Self {
        Self {
            max_file_size_mb: 5,
            max_chars_per_file: 100_000,
            max_chunks_per_file: 200,
            chunk_size: 1200,
            chunk_overlap: 150,
        }
    }
}

#[derive(Debug, Serialize)]
struct DocumentChunk {
    content: String,
    chunk_index: usize,
    chunk_total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum DocumentFileStatus {
    Supported,
    Skipped,
}

#[derive(Debug, Serialize)]
struct DocumentFileResult {
    path: String,
    relative_path: String,
    extension: String,
    size_bytes: u64,
    status: DocumentFileStatus,
    reason: String,
    chunks: Vec<DocumentChunk>,
}

#[derive(Debug, Serialize)]
struct DocumentScanSummary {
    discovered_files: usize,
    supported_files: usize,
    skipped_files: usize,
}

#[derive(Debug, Serialize)]
struct DocumentEngineOutput {
    scan_summary: DocumentScanSummary,
    files: Vec<DocumentFileResult>,
}

fn run_document_mode(input_path: &str, limits_json: Option<&str>) {
    let limits = parse_document_limits(limits_json);
    let input = Path::new(input_path);
    let mut files = Vec::new();
    collect_all_files(input, &mut files);
    files.sort();
    let discovered_files = files.len();

    let base_dir = if input.is_dir() {
        input.to_path_buf()
    } else {
        input
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    };

    let mut results = Vec::new();
    let mut supported_files = 0usize;
    let mut skipped_files = 0usize;

    for file in &files {
        let relative_path = file
            .strip_prefix(&base_dir)
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|_| file.file_name().map(|v| v.to_string_lossy().to_string()).unwrap_or_default());
        let extension = file
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!(".{}", ext.to_ascii_lowercase()))
            .unwrap_or_default();
        let size_bytes = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);

        let result = parse_document_file(&file, &relative_path, &extension, size_bytes, &limits);
        if matches!(result.status, DocumentFileStatus::Supported) {
            supported_files += 1;
        } else {
            skipped_files += 1;
        }
        results.push(result);
    }

    let output = DocumentEngineOutput {
        scan_summary: DocumentScanSummary {
            discovered_files,
            supported_files,
            skipped_files,
        },
        files: results,
    };

    write_json_output(&output);
}

fn parse_document_limits(limits_json: Option<&str>) -> DocumentImportLimits {
    let defaults = DocumentImportLimits::default();
    let Some(raw) = limits_json else {
        return defaults;
    };

    let parsed = serde_json::from_str::<DocumentImportLimits>(raw);
    match parsed {
        Ok(value) => DocumentImportLimits {
            max_file_size_mb: if value.max_file_size_mb == 0 {
                defaults.max_file_size_mb
            } else {
                value.max_file_size_mb
            },
            max_chars_per_file: if value.max_chars_per_file == 0 {
                defaults.max_chars_per_file
            } else {
                value.max_chars_per_file
            },
            max_chunks_per_file: if value.max_chunks_per_file == 0 {
                defaults.max_chunks_per_file
            } else {
                value.max_chunks_per_file
            },
            chunk_size: if value.chunk_size == 0 {
                defaults.chunk_size
            } else {
                value.chunk_size
            },
            chunk_overlap: value.chunk_overlap,
        },
        Err(_) => defaults,
    }
}

fn collect_all_files(path: &Path, out: &mut Vec<PathBuf>) {
    if path.is_file() {
        out.push(path.to_path_buf());
        return;
    }

    let read_dir = match fs::read_dir(path) {
        Ok(dir) => dir,
        Err(_) => return,
    };

    for entry_result in read_dir {
        let Ok(entry) = entry_result else {
            continue;
        };
        let child = entry.path();
        if child.is_dir() {
            collect_all_files(&child, out);
        } else if child.is_file() {
            out.push(child);
        }
    }
}

fn parse_document_file(
    file: &Path,
    relative_path: &str,
    extension: &str,
    size_bytes: u64,
    limits: &DocumentImportLimits,
) -> DocumentFileResult {
    let path = file.to_string_lossy().to_string();
    let max_size_bytes = limits.max_file_size_mb as u64 * 1024 * 1024;
    if !matches!(
        extension,
        ".csv" | ".json" | ".jsonl" | ".ndjson" | ".md" | ".txt"
    ) {
        return skipped_doc(path, relative_path.to_string(), extension.to_string(), size_bytes, "unsupported_extension");
    }
    if size_bytes > max_size_bytes {
        return skipped_doc(path, relative_path.to_string(), extension.to_string(), size_bytes, "file_exceeds_max_size");
    }

    let content = match fs::read_to_string(file) {
        Ok(value) => value,
        Err(_) => {
            return skipped_doc(path, relative_path.to_string(), extension.to_string(), size_bytes, "read_error");
        }
    };

    if content.chars().count() > limits.max_chars_per_file {
        return skipped_doc(path, relative_path.to_string(), extension.to_string(), size_bytes, "file_exceeds_max_chars");
    }

    let chunks = match extension {
        ".md" | ".txt" => chunk_text(&content, limits),
        ".json" => parse_json_records(&content, limits).unwrap_or_else(|reason| {
            return_vec_with_error(reason)
        }),
        ".jsonl" | ".ndjson" => parse_jsonl_records(&content, limits).unwrap_or_else(|reason| {
            return_vec_with_error(reason)
        }),
        ".csv" => parse_csv_records(&content, limits).unwrap_or_else(|reason| {
            return_vec_with_error(reason)
        }),
        _ => Vec::new(),
    };

    if chunks.is_empty() {
        return skipped_doc(path, relative_path.to_string(), extension.to_string(), size_bytes, "empty_content");
    }

    if chunks[0].content.starts_with("__error__:") {
        let reason = chunks[0].content.trim_start_matches("__error__:");
        return skipped_doc(path, relative_path.to_string(), extension.to_string(), size_bytes, reason);
    }

    DocumentFileResult {
        path,
        relative_path: relative_path.to_string(),
        extension: extension.to_string(),
        size_bytes,
        status: DocumentFileStatus::Supported,
        reason: "parsed".to_string(),
        chunks,
    }
}

fn return_vec_with_error(reason: &'static str) -> Vec<DocumentChunk> {
    vec![DocumentChunk {
        content: format!("__error__:{reason}"),
        chunk_index: 0,
        chunk_total: 1,
    }]
}

fn skipped_doc(
    path: String,
    relative_path: String,
    extension: String,
    size_bytes: u64,
    reason: &str,
) -> DocumentFileResult {
    DocumentFileResult {
        path,
        relative_path,
        extension,
        size_bytes,
        status: DocumentFileStatus::Skipped,
        reason: reason.to_string(),
        chunks: Vec::new(),
    }
}

fn parse_json_records(
    content: &str,
    limits: &DocumentImportLimits,
) -> Result<Vec<DocumentChunk>, &'static str> {
    let parsed = serde_json::from_str::<Value>(content).map_err(|_| "invalid_json")?;
    let records: Vec<String> = match parsed {
        Value::Array(items) => items.into_iter().map(stringify_value).collect(),
        Value::Object(_) => vec![stringify_value(parsed)],
        other => vec![stringify_value(other)],
    };
    Ok(records_to_chunks(records, limits.max_chunks_per_file))
}

fn parse_jsonl_records(
    content: &str,
    limits: &DocumentImportLimits,
) -> Result<Vec<DocumentChunk>, &'static str> {
    let mut records = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed = serde_json::from_str::<Value>(trimmed).map_err(|_| "invalid_jsonl")?;
        records.push(stringify_value(parsed));
    }
    Ok(records_to_chunks(records, limits.max_chunks_per_file))
}

fn parse_csv_records(
    content: &str,
    limits: &DocumentImportLimits,
) -> Result<Vec<DocumentChunk>, &'static str> {
    let lines: Vec<&str> = content
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.is_empty() {
        return Err("empty_csv");
    }
    let headers = split_csv_line(lines[0]);
    if headers.is_empty() {
        return Err("empty_csv");
    }
    let mut records = Vec::new();
    for line in lines.iter().skip(1) {
        let values = split_csv_line(line);
        let mut map = serde_json::Map::new();
        for (idx, header) in headers.iter().enumerate() {
            let key = if header.trim().is_empty() {
                format!("col_{}", idx + 1)
            } else {
                header.trim().to_string()
            };
            let value = values.get(idx).cloned().unwrap_or_default();
            map.insert(key, Value::String(value));
        }
        records.push(Value::Object(map).to_string());
    }
    if records.is_empty() {
        return Err("empty_csv");
    }
    Ok(records_to_chunks(records, limits.max_chunks_per_file))
}

fn split_csv_line(line: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '"' {
            let next = if i + 1 < chars.len() { Some(chars[i + 1]) } else { None };
            if in_quotes && next == Some('"') {
                current.push('"');
                i += 2;
                continue;
            }
            in_quotes = !in_quotes;
            i += 1;
            continue;
        }
        if ch == ',' && !in_quotes {
            values.push(current.clone());
            current.clear();
            i += 1;
            continue;
        }
        current.push(ch);
        i += 1;
    }
    values.push(current);
    values
}

fn chunk_text(content: &str, limits: &DocumentImportLimits) -> Vec<DocumentChunk> {
    if content.trim().is_empty() {
        return Vec::new();
    }
    let chars: Vec<char> = content.chars().collect();
    let safe_chunk_size = if limits.chunk_size == 0 { 1 } else { limits.chunk_size };
    let safe_overlap = limits.chunk_overlap.min(safe_chunk_size.saturating_sub(1));
    let step = (safe_chunk_size - safe_overlap).max(1);
    let mut chunks: Vec<String> = Vec::new();
    let mut start = 0usize;
    while start < chars.len() && chunks.len() < limits.max_chunks_per_file {
        let end = (start + safe_chunk_size).min(chars.len());
        let piece: String = chars[start..end].iter().collect::<String>().trim().to_string();
        if !piece.is_empty() {
            chunks.push(piece);
        }
        if end >= chars.len() {
            break;
        }
        start += step;
    }
    records_to_chunks(chunks, limits.max_chunks_per_file)
}

fn records_to_chunks(records: Vec<String>, max_chunks_per_file: usize) -> Vec<DocumentChunk> {
    let limited: Vec<String> = records.into_iter().take(max_chunks_per_file).collect();
    let total = limited.len();
    limited
        .into_iter()
        .enumerate()
        .map(|(idx, content)| DocumentChunk {
            content,
            chunk_index: idx,
            chunk_total: total,
        })
        .collect()
}

fn stringify_value(value: Value) -> String {
    match value {
        Value::String(s) => s,
        Value::Object(_) | Value::Array(_) => value.to_string(),
        Value::Null => String::new(),
        Value::Bool(v) => v.to_string(),
        Value::Number(v) => v.to_string(),
    }
}

fn write_json_output<T: Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(json) => {
            let mut stdout = io::stdout().lock();
            if let Err(err) = stdout.write_all(json.as_bytes()) {
                if err.kind() != io::ErrorKind::BrokenPipe {
                    eprintln!("Failed to write output JSON: {err}");
                    std::process::exit(1);
                }
            }
            let _ = stdout.write_all(b"\n");
        }
        Err(err) => {
            eprintln!("Failed to serialize output JSON: {err}");
            std::process::exit(1);
        }
    }
}
