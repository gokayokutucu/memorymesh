import { IRawMappingNode } from "./types";

export function normalizeMapping(mapping: unknown): Record<string, IRawMappingNode> {
  if (!mapping || typeof mapping !== "object") {
    return {};
  }

  const source = mapping as Record<string, unknown>;
  const normalized: Record<string, IRawMappingNode> = {};
  for (const [id, rawNode] of Object.entries(source)) {
    const node = (rawNode ?? {}) as Record<string, unknown>;
    const children = Array.isArray(node.children)
      ? node.children.filter((child): child is string => typeof child === "string")
      : [];
    normalized[id] = {
      id,
      parent: typeof node.parent === "string" ? node.parent : null,
      children,
      message: node.message as IRawMappingNode["message"] | undefined,
    };
  }

  return normalized;
}

export function reconstructOrderedNodes(
  mapping: Record<string, IRawMappingNode>,
  currentNode: unknown
): IRawMappingNode[] {
  const ids = Object.keys(mapping);
  if (ids.length === 0) {
    return [];
  }

  const rootId = findRootId(mapping, ids[0]);
  const terminalId = resolveTerminalId(mapping, currentNode, rootId);
  const chainIds = buildParentChain(mapping, terminalId, rootId);

  return chainIds
    .map((id) => mapping[id])
    .filter((node): node is IRawMappingNode => Boolean(node));
}

function findRootId(mapping: Record<string, IRawMappingNode>, fallbackId: string): string {
  for (const node of Object.values(mapping)) {
    if (!node.parent || !mapping[node.parent]) {
      return node.id;
    }
  }
  return fallbackId;
}

function resolveTerminalId(
  mapping: Record<string, IRawMappingNode>,
  currentNode: unknown,
  rootId: string
): string {
  if (typeof currentNode === "string" && mapping[currentNode]) {
    return currentNode;
  }

  let cursor = rootId;
  const visited = new Set<string>();
  while (!visited.has(cursor)) {
    visited.add(cursor);
    const next = mapping[cursor]?.children.find((childId) => mapping[childId]);
    if (!next) {
      return cursor;
    }
    cursor = next;
  }

  return cursor;
}

function buildParentChain(
  mapping: Record<string, IRawMappingNode>,
  terminalId: string,
  rootId: string
): string[] {
  const chain: string[] = [];
  let cursor: string | null | undefined = terminalId;
  const visited = new Set<string>();

  while (cursor && mapping[cursor] && !visited.has(cursor)) {
    chain.push(cursor);
    visited.add(cursor);
    cursor = mapping[cursor].parent ?? undefined;
  }

  const rootIndex = chain.lastIndexOf(rootId);
  if (rootIndex >= 0) {
    return chain.slice(0, rootIndex + 1).reverse();
  }

  return chain.reverse();
}
