import {
  MODE_TOOL_RISK_LIMITS,
  type InteractionMode,
  type RiskLevel,
  type ToolDefinition,
  type ToolRegistry,
  type ToolSource,
} from "../providers/tool-registry";

const RISK_ORDER: Record<RiskLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

export class ToolRegistryImpl implements ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) throw new Error(`Tool already registered: ${tool.id}`);
    this.tools.set(tool.id, tool);
  }

  unregister(toolId: string): void {
    this.tools.delete(toolId);
  }

  get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  list(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }

  listBySource(source: ToolSource): readonly ToolDefinition[] {
    return this.list().filter((tool) => tool.source === source);
  }

  listByRiskLevel(maxLevel: RiskLevel): readonly ToolDefinition[] {
    const limit = RISK_ORDER[maxLevel];
    return this.list().filter((tool) => RISK_ORDER[tool.riskLevel] <= limit);
  }

  listForMode(mode: InteractionMode): readonly ToolDefinition[] {
    return this.listByRiskLevel(MODE_TOOL_RISK_LIMITS[mode]);
  }
}

export function createToolRegistry(): ToolRegistryImpl {
  return new ToolRegistryImpl();
}

export function riskLevelExceeds(level: RiskLevel, maximum: RiskLevel): boolean {
  return RISK_ORDER[level] > RISK_ORDER[maximum];
}
