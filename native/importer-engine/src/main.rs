use serde::Serialize;
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
    let Some(input_path) = args.next() else {
        eprintln!("Usage: importer-engine <path>");
        std::process::exit(1);
    };

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
