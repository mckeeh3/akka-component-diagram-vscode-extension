import { AkkaComponent, AkkaEdge } from '../models/types';

export interface MermaidDiagramOptions {
  title?: string;
  direction?: 'TB' | 'TD' | 'BT' | 'RL' | 'LR';
  theme?: 'default' | 'forest' | 'dark' | 'neutral';
}

/**
 * Generates a Mermaid diagram from Akka component data
 */
export function generateMermaidDiagram(nodes: AkkaComponent[], edges: AkkaEdge[], options: MermaidDiagramOptions = {}): string {
  const { title = 'Akka Component Diagram', direction = 'TB', theme = 'neutral' } = options;

  // Generate node definitions
  const nodeDefinitions = nodes
    .map((node) => {
      const nodeId = sanitizeNodeId(node.id);
      const nodeType = getNodeType(node.type);
      return `    ${nodeId}["${node.name}"]:::${nodeType}`;
    })
    .join('\n');

  // Generate edge definitions
  const edgeDefinitions = edges
    .map((edge) => {
      const sourceId = sanitizeNodeId(edge.source);
      const targetId = sanitizeNodeId(edge.target);
      const label = edge.label || '';
      return `    ${sourceId} -->|"${label}"| ${targetId}`;
    })
    .join('\n');

  // Generate CSS classes for different node types
  const cssClasses = generateCssClasses();

  return `# ${title}

\`\`\`mermaid
---
config:
  theme: '${theme}'
---

graph ${direction}

${nodeDefinitions}

${edgeDefinitions}

${cssClasses}
\`\`\`
`;
}

/**
 * Sanitize node ID for Mermaid compatibility
 */
function sanitizeNodeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&'); // Ensure it doesn't start with a number
}

/**
 * Map Akka component types to Mermaid node types
 */
function getNodeType(type: string): string {
  switch (type.toLowerCase()) {
    case 'endpoint':
    case 'httpendpoint':
    case 'grpcendpoint':
    case 'mcpendpoint':
      return 'endpoint';
    case 'entity':
      return 'entity';
    case 'view':
      return 'view';
    case 'consumer':
      return 'consumer';
    case 'workflow':
      return 'workflow';
    case 'topic':
      return 'topic';
    case 'servicestream':
      return 'servicestream';
    default:
      return 'component';
  }
}

/**
 * Generate CSS classes for different node types
 */
function generateCssClasses(): string {
  return `classDef endpoint fill:#e1f5fe,stroke:#01579b,stroke-width:2px
classDef entity fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
classDef view fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
classDef consumer fill:#fff3e0,stroke:#e65100,stroke-width:2px
classDef workflow fill:#fce4ec,stroke:#880e4f,stroke-width:2px
classDef topic fill:#f1f8e9,stroke:#33691e,stroke-width:2px,stroke-dasharray: 5 5
classDef servicestream fill:#e0f2f1,stroke:#004d40,stroke-width:2px,stroke-dasharray: 5 5
classDef functiontool fill:#f5f5f5,stroke:#616161,stroke-width:2px,stroke-dasharray: 2 2
classDef mcptool fill:#eceff1,stroke:#37474f,stroke-width:2px,stroke-dasharray: 2 2
classDef component fill:#fafafa,stroke:#424242,stroke-width:2px`;
}

/**
 * Generate a simplified Mermaid diagram (nodes only, no edges)
 */
export function generateSimpleMermaidDiagram(nodes: AkkaComponent[], options: MermaidDiagramOptions = {}): string {
  const { title = 'Akka Components', direction = 'TB', theme = 'neutral' } = options;

  // Generate node definitions
  const nodeDefinitions = nodes
    .map((node) => {
      const nodeId = sanitizeNodeId(node.id);
      const nodeType = getNodeType(node.type);
      return `    ${nodeId}["${node.name}"]:::${nodeType}`;
    })
    .join('\n');

  // Generate CSS classes
  const cssClasses = generateCssClasses();

  return `# ${title}

\`\`\`mermaid
---
config:
  theme: '${theme}'
---

graph ${direction}

${nodeDefinitions}

${cssClasses}
\`\`\`
`;
}
