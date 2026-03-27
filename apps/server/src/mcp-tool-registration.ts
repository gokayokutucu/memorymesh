import { getMemoryPermissionConfig } from "@memorymesh/runtime";

export type MemoryMcpMode = "READ_WRITE" | "READ_ONLY" | "WRITE_ONLY" | "ISOLATED";

export interface IMemoryToolRegistrationPlan {
  mode: MemoryMcpMode;
  readToolsEnabled: boolean;
  writeToolsEnabled: boolean;
  readToolNames: string[];
  writeToolNames: string[];
  alwaysOnToolNames: string[];
}

const READ_TOOL_NAMES = [
  "search_memory",
  "get_memory",
  "get_memory_by_ref",
  "get_related_memories",
  "list_projects",
];

const WRITE_TOOL_NAMES = ["save_memory", "get_memory_status"];
const ALWAYS_ON_TOOL_NAMES = ["get_runtime_health"];

export function resolveMemoryMcpMode(
  readEnabled: boolean,
  writeEnabled: boolean
): MemoryMcpMode {
  if (readEnabled && writeEnabled) {
    return "READ_WRITE";
  }
  if (readEnabled && !writeEnabled) {
    return "READ_ONLY";
  }
  if (!readEnabled && writeEnabled) {
    return "WRITE_ONLY";
  }
  return "ISOLATED";
}

export function getMemoryToolRegistrationPlan(): IMemoryToolRegistrationPlan {
  const permissionConfig = getMemoryPermissionConfig();
  return {
    mode: resolveMemoryMcpMode(
      permissionConfig.readEnabled,
      permissionConfig.writeEnabled
    ),
    readToolsEnabled: permissionConfig.readEnabled,
    writeToolsEnabled: permissionConfig.writeEnabled,
    readToolNames: READ_TOOL_NAMES,
    writeToolNames: WRITE_TOOL_NAMES,
    alwaysOnToolNames: ALWAYS_ON_TOOL_NAMES,
  };
}

export function getRegisteredToolNames(
  plan: IMemoryToolRegistrationPlan
): string[] {
  return [
    ...plan.alwaysOnToolNames,
    ...(plan.readToolsEnabled ? plan.readToolNames : []),
    ...(plan.writeToolsEnabled ? plan.writeToolNames : []),
  ];
}

export function formatMemoryMcpModeSummary(
  plan: IMemoryToolRegistrationPlan
): string[] {
  const registeredTools = getRegisteredToolNames(plan);
  return [
    `MemoryMesh MCP mode: ${plan.mode}`,
    `read tools: ${plan.readToolsEnabled ? "enabled" : "disabled"}`,
    `write tools: ${plan.writeToolsEnabled ? "enabled" : "disabled"}`,
    `registered tools: ${registeredTools.join(", ")}`,
  ];
}
