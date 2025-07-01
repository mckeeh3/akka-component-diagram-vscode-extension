import * as vscode from 'vscode';
import * as path from 'path';
import { getWebviewContent, SerializableDiagramData, ViewState } from './webview/webviewManager';

// --- Type Definitions ---

interface AkkaComponent {
  id: string; // The class name, used as a unique ID
  name: string; // The component name from the annotation (e.g., "customer")
  type: string; // e.g., "EventSourcedEntity", "HttpEndpoint"
  uri: vscode.Uri; // The URI of the file where the component is defined
  x?: number; // Optional X coordinate for layout
  y?: number; // Optional Y coordinate for layout
}

interface AkkaEdge {
  source: string;
  target: string;
  label: string;
  details: string[]; // To hold detailed interaction info, e.g., method names
}

// Data passed from the extension to the webview
// SerializableDiagramData and ViewState are now imported from webviewManager

// --- Extension Activation ---

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "akka-diagram-generator" is now active!');

  let scanProjectDisposable = vscode.commands.registerCommand('akka-diagram-generator.scanProject', async (uri: vscode.Uri) => {
    let scanFolder: vscode.WorkspaceFolder | undefined;
    let relativePath: string;

    if (uri) {
      scanFolder = vscode.workspace.getWorkspaceFolder(uri);
      if (!scanFolder) {
        vscode.window.showErrorMessage('Selected file is not part of a workspace folder.');
        return;
      }
      relativePath = path.relative(scanFolder.uri.fsPath, uri.fsPath);
    } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      scanFolder = vscode.workspace.workspaceFolders[0];
      relativePath = '';
    } else {
      vscode.window.showErrorMessage('No folder open in workspace.');
      return;
    }

    const pattern = new vscode.RelativePattern(path.join(scanFolder.uri.fsPath, relativePath), '**/*.java');
    const javaFiles = await vscode.workspace.findFiles(pattern, '**/target/**');

    if (javaFiles.length === 0) {
      vscode.window.showWarningMessage('No Java files found in the selected folder.');
      return;
    }

    vscode.window.showInformationMessage(`Scanning ${javaFiles.length} Java file(s)...`);

    const parsedNodes = await parseNodes(javaFiles);
    const foundEdges = await parseEdges(parsedNodes);

    const aggregatedEdges = aggregateEdges(foundEdges);

    // --- Load saved layouts from workspace state ---
    const savedNodeLayout = context.workspaceState.get<{ [id: string]: { x: number; y: number } }>('akkaDiagramLayout', {});
    const savedViewState = context.workspaceState.get<ViewState>('akkaDiagramViewState', { panX: 0, panY: 0, scale: 1 });

    const nodesWithLayout = Array.from(parsedNodes.values()).map((node) => ({
      ...node,
      ...savedNodeLayout[node.id], // Apply saved coordinates if they exist
    }));

    const diagramData = { nodes: nodesWithLayout, edges: aggregatedEdges };

    // --- Create the Webview Panel ---
    if (diagramData.nodes.length > 0) {
      createDiagramPanel(context, diagramData, savedViewState);
    } else {
      vscode.window.showWarningMessage('No Akka components found in this project.');
    }
  });

  context.subscriptions.push(scanProjectDisposable);
}

// --- Parsing Functions ---

async function parseNodes(files: vscode.Uri[]): Promise<Map<string, AkkaComponent>> {
  const parsedNodes = new Map<string, AkkaComponent>();
  for (const file of files) {
    const document = await vscode.workspace.openTextDocument(file);
    const text = document.getText();
    const componentRegex = /@(ComponentId|HttpEndpoint|GrpcEndpoint)(?:\("([^"]+)"\))?[\s\S]*?public\s+class\s+(\w+)(?:\s+(?:extends|implements)\s+(\w+))?/g;

    let match;
    while ((match = componentRegex.exec(text)) !== null) {
      const [_, annotationType, componentId, className, extendedOrImplementedClass] = match;
      let componentType: string = annotationType === 'ComponentId' ? extendedOrImplementedClass || 'Unknown' : annotationType;

      if (!parsedNodes.has(className)) {
        parsedNodes.set(className, {
          id: className,
          name: componentId || className,
          type: componentType,
          uri: file,
        });
      }
    }
  }
  return parsedNodes;
}

async function parseEdges(nodes: Map<string, AkkaComponent>): Promise<AkkaEdge[]> {
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

function aggregateEdges(edges: AkkaEdge[]): AkkaEdge[] {
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

// --- Webview Panel Creation ---

function createDiagramPanel(context: vscode.ExtensionContext, data: { nodes: AkkaComponent[]; edges: AkkaEdge[] }, viewState: ViewState) {
  const panel = vscode.window.createWebviewPanel('akkaDiagram', 'Akka Component Diagram', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });

  panel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'saveLayout':
          const currentLayout = context.workspaceState.get('akkaDiagramLayout', {});
          context.workspaceState.update('akkaDiagramLayout', { ...currentLayout, ...message.payload });
          return;
        case 'saveViewState':
          context.workspaceState.update('akkaDiagramViewState', message.payload);
          return;
        case 'navigateTo':
          const component = data.nodes.find((n) => n.id === message.payload.componentId);
          if (component && component.uri.scheme !== 'untitled') {
            const document = await vscode.workspace.openTextDocument(component.uri);
            const editor = await vscode.window.showTextDocument(document);

            const text = document.getText();
            const regex = new RegExp(`class\\s+${component.id}`);
            const match = text.match(regex);
            if (match && typeof match.index === 'number') {
              const pos = document.positionAt(match.index);
              editor.selection = new vscode.Selection(pos, pos);
              editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
          }
          return;
      }
    },
    undefined,
    context.subscriptions
  );

  const serializableData: SerializableDiagramData = {
    nodes: data.nodes.map(({ id, name, type, x, y }) => ({ id, name, type, x, y })),
    edges: data.edges,
  };

  panel.webview.html = getWebviewContent(serializableData, viewState, context.extensionUri);
}

// getWebviewContent is now imported from webviewManager

export function deactivate() {}
