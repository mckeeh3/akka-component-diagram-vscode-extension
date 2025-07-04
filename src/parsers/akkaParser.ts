import * as vscode from 'vscode';
import { AkkaComponent, AkkaEdge } from '../models/types';
import * as path from 'path';
import { createPrefixedLogger } from '../utils/logger';

export async function parseNodes(files: vscode.Uri[], outputChannel?: vscode.OutputChannel): Promise<Map<string, AkkaComponent>> {
  const log = outputChannel ? createPrefixedLogger(outputChannel, '[RegEx]') : console.log;
  log(`[RegEx] Starting to parse ${files.length} files for components`);
  const parsedNodes = new Map<string, AkkaComponent>();

  for (const file of files) {
    log(`[RegEx] Processing file: ${file.fsPath}`);
    const document = await vscode.workspace.openTextDocument(file);
    const text = document.getText();
    const componentRegex = /@(ComponentId|HttpEndpoint|GrpcEndpoint)(?:\("([^"]+)"\))?[\s\S]*?public\s+class\s+(\w+)(?:\s+(?:extends|implements)\s+(\w+))?/g;

    let match;
    let fileComponentCount = 0;
    while ((match = componentRegex.exec(text)) !== null) {
      const [_, annotationType, componentId, className, extendedOrImplementedClass] = match;
      let componentType: string = annotationType === 'ComponentId' ? extendedOrImplementedClass || 'Unknown' : annotationType;

      log(`[RegEx] Found component: ${className} (${annotationType}) with type: ${componentType}`);

      if (!parsedNodes.has(className)) {
        parsedNodes.set(className, {
          id: className,
          name: componentId || className,
          type: componentType,
          uri: file,
        });
        fileComponentCount++;
      }
    }
    log(`[RegEx] File ${path.basename(file.fsPath)}: found ${fileComponentCount} components`);
  }

  log(`[RegEx] Total components found: ${parsedNodes.size}`);
  return parsedNodes;
}

export async function parseEdges(nodes: Map<string, AkkaComponent>, outputChannel?: vscode.OutputChannel): Promise<AkkaEdge[]> {
  const log = outputChannel ? createPrefixedLogger(outputChannel, '[RegEx]') : console.log;
  log(`[RegEx] Starting to parse edges for ${nodes.size} nodes`);
  const foundEdges: AkkaEdge[] = [];
  for (const sourceNode of nodes.values()) {
    if (sourceNode.uri.scheme === 'untitled') continue;
    const document = await vscode.workspace.openTextDocument(sourceNode.uri);
    const text = document.getText();

    const methodCallRegex = /\.method\s*\(([\w:]+)\)/g;
    const clientCallRegex = /componentClient\.for(?:EventSourcedEntity|KeyValueEntity|View|Workflow|TimedAction)\(.*\)$/s;

    let match;
    while ((match = methodCallRegex.exec(text)) !== null) {
      const methodRef = match[1];
      const cleanedPrecedingText = text.substring(0, match.index).replace(/\s*\n\s*/g, '');
      if (clientCallRegex.test(cleanedPrecedingText)) {
        const [targetClass, methodName] = methodRef.split('::');
        if (nodes.has(targetClass)) {
          foundEdges.push({ source: sourceNode.id, target: targetClass, label: methodName, details: [] });
        }
      }
    }

    const consumeRegex = /@Consume\.From(EventSourcedEntity|KeyValueEntity|Workflow|Topic|ServiceStream)\((?:value\s*=\s*)?(?:(\w+)\.class|(?:"([^"]+)"))\)/g;
    const produceRegex = /@Produce\.To(Topic|ServiceStream)\("([^"]+)"\)/g;

    while ((match = consumeRegex.exec(text)) !== null) {
      const [_, fromType, fromClass, fromString] = match;
      const consumeSource = fromClass || fromString;
      const detailLabel = fromType === 'Topic' || fromType === 'ServiceStream' ? 'consumes' : `${fromType} events`;
      if (!nodes.has(consumeSource)) {
        nodes.set(consumeSource, { id: consumeSource, name: consumeSource, type: fromType, uri: vscode.Uri.parse(`untitled:Topic/${consumeSource}`) });
      }
      foundEdges.push({ source: consumeSource, target: sourceNode.id, label: detailLabel, details: [] });
    }

    while ((match = produceRegex.exec(text)) !== null) {
      const [_, toType, toName] = match;
      if (!nodes.has(toName)) {
        nodes.set(toName, { id: toName, name: toName, type: toType, uri: vscode.Uri.parse(`untitled:Topic/${toName}`) });
      }
      foundEdges.push({ source: sourceNode.id, target: toName, label: 'produces to', details: [] });
    }
  }
  return foundEdges;
}

export function aggregateEdges(edges: AkkaEdge[]): AkkaEdge[] {
  const edgeMap = new Map<string, AkkaEdge>();

  edges.forEach((edge) => {
    const key = `${edge.source}->${edge.target}`;
    const existing = edgeMap.get(key);

    if (existing) {
      if (edge.label !== 'consumes' && edge.label !== 'produces to' && !existing.details.includes(edge.label)) {
        existing.details.push(edge.label);
      }
    } else {
      const newEdge: AkkaEdge = {
        source: edge.source,
        target: edge.target,
        label: '', // Will be set later
        details: [],
      };
      if (edge.label !== 'consumes' && edge.label !== 'produces to') {
        newEdge.details.push(edge.label);
      }
      edgeMap.set(key, newEdge);
    }
  });

  return Array.from(edgeMap.values()).map((edge) => {
    if (edge.details.length > 0) {
      edge.label = `invokes (${edge.details.length} methods)`;
    } else {
      const originalEdge = edges.find((e) => e.source === edge.source && e.target === edge.target);
      edge.label = originalEdge ? originalEdge.label : '';
    }
    return edge;
  });
}
