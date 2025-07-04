import * as vscode from 'vscode';
import * as path from 'path';
import { getWebviewContent } from './webview/webviewManager';
import { JavaParser } from './parsers/javaParser';
import { parseNodes, parseEdges, aggregateEdges } from './parsers/akkaParser';
import { extractComponentConnectionsFromCST, extractSourceAtLocation } from './parsers/javaCstUtils';
import { AkkaComponent, AkkaEdge, SerializableDiagramData, ViewState } from './models/types';

// --- Type Definitions ---

// Global variable to track the existing diagram panel
let currentDiagramPanel: vscode.WebviewPanel | undefined;

// --- Extension Activation ---

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "akka-diagram-generator" is now active!');
  console.log('[Extension] Extension activation started');

  // Create output channel for debugging
  const outputChannel = vscode.window.createOutputChannel('Akka Diagram Generator');
  outputChannel.appendLine('[Extension] Akka Diagram Generator extension activated');
  outputChannel.appendLine('[Extension] Extension activation started');
  outputChannel.show(); // Make the output channel visible

  let scanProjectDisposable = vscode.commands.registerCommand('akka-diagram-generator.scanProject', async (uri: vscode.Uri) => {
    // Combined log function that outputs to both outputChannel and console
    const log = (...args: any[]) => {
      const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      outputChannel.appendLine(msg);
      console.log(msg);
    };

    try {
      log('[Extension] ========================================');
      log('[Extension] COMMAND EXECUTED: akka-diagram-generator.scanProject');
      log('[Extension] ========================================');
      log('[Extension] Command "akka-diagram-generator.scanProject" executed');

      let scanFolder: vscode.WorkspaceFolder | undefined;
      let relativePath: string;

      if (uri) {
        log(`[Extension] URI provided: ${uri.fsPath}`);
        scanFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!scanFolder) {
          vscode.window.showErrorMessage('Selected file is not part of a workspace folder.');
          return;
        }
        relativePath = path.relative(scanFolder.uri.fsPath, uri.fsPath);
      } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        scanFolder = vscode.workspace.workspaceFolders[0];
        relativePath = '';
        log(`[Extension] Using workspace folder: ${scanFolder.uri.fsPath}`);
      } else {
        vscode.window.showErrorMessage('No folder open in workspace.');
        return;
      }

      const pattern = new vscode.RelativePattern(path.join(scanFolder.uri.fsPath, relativePath), '**/*.java');
      log(`[Extension] Searching for Java files with pattern: ${pattern.pattern}`);

      const javaFiles = await vscode.workspace.findFiles(pattern, '**/target/**');

      if (javaFiles.length === 0) {
        vscode.window.showWarningMessage('No Java files found in the selected folder.');
        log('[Extension] No Java files found');
        return;
      }

      vscode.window.showInformationMessage(`Scanning ${javaFiles.length} Java file(s)...`);
      log(`[Extension] Found ${javaFiles.length} Java files to scan`);

      // --- Java Parser Step ---
      log(`[Extension] ========================================`);
      log(`[Extension] STARTING JAVA PARSER STEP`);
      log(`[Extension] ========================================`);
      log(`[Extension] Starting Java parser for ${javaFiles.length} files`);

      const parseResults = await JavaParser.parseFiles(javaFiles);
      log(`[Extension] Java parser completed, processing ${parseResults.length} results`);

      // Count successes and failures
      const successfulParses = parseResults.filter((r) => r.success);
      const failedParses = parseResults.filter((r) => !r.success);

      log(`[Extension] Java parsing complete. Success: ${successfulParses.length}, Failures: ${failedParses.length}`);

      // Show user feedback
      if (failedParses.length > 0) {
        failedParses.forEach((result) => {
          vscode.window.showWarningMessage(`Failed to parse Java file: ${path.basename(result.filename)}`);
          log(`[Extension] Parse failed: ${result.filename} - ${result.error}`);
        });
      }

      vscode.window.showInformationMessage(`Java parser: ${successfulParses.length} files parsed successfully, ${failedParses.length} failures`);

      // Debug: Log CST structure for first successful parse
      if (successfulParses.length > 0) {
        log(`[Extension] Debugging CST structure for: ${successfulParses[0].filename}`);
      }

      // --- Extract Annotations from CST ---
      log(`[Extension] ========================================`);
      log(`[Extension] STARTING ANNOTATION EXTRACTION`);
      log(`[Extension] ========================================`);
      log(`[Extension] Starting annotation extraction from CST...`);

      const allAnnotations: Array<{
        filename: string;
        annotations: Array<{ name: string; arguments?: string[]; location?: any }>;
      }> = [];

      for (const result of successfulParses) {
        if (result.cst) {
          const annotations = JavaParser.extractAnnotationsFromCST(result.cst);
          allAnnotations.push({
            filename: result.filename,
            annotations,
          });

          log(`[Extension] File ${path.basename(result.filename)}: Found ${annotations.length} annotations`);

          // Get the source text for this file
          const document = await vscode.workspace.openTextDocument(result.filename);
          const sourceText = document.getText();

          // Log each annotation for debugging
          annotations.forEach((annotation, index) => {
            const locationInfo = annotation.location ? `line ${annotation.location.startLine}, col ${annotation.location.startColumn}` : 'unknown location';

            log(`[Extension]   Annotation ${index + 1}: ${annotation.name} at ${locationInfo}`);

            // Log the actual source code for the annotation
            if (annotation.location && sourceText) {
              const annotationSourceCode = extractSourceAtLocation(sourceText, annotation.location);
              log(`[Extension]     Source code: "${annotationSourceCode}"`);
            }

            if (annotation.arguments && annotation.arguments.length > 0) {
              log(`[Extension]     Arguments: ${annotation.arguments.join(', ')}`);
            }
          });
        }
      }

      // Look for Akka-specific annotations
      const akkaAnnotations = ['ComponentId', 'HttpEndpoint', 'GrpcEndpoint', 'MCPEndpoint'];
      const foundAkkaAnnotations = allAnnotations.flatMap((fileResult) => fileResult.annotations.filter((ann) => akkaAnnotations.includes(ann.name)));

      log(`[Extension] Found ${foundAkkaAnnotations.length} Akka-specific annotations across all files`);

      if (foundAkkaAnnotations.length > 0) {
        foundAkkaAnnotations.forEach((annotation, index) => {
          log(`[Extension]   Akka annotation ${index + 1}: ${annotation.name}`);
          if (annotation.arguments && annotation.arguments.length > 0) {
            log(`[Extension]     Arguments: ${annotation.arguments.join(', ')}`);
          }
        });
      }

      // --- Extract Akka Components from CST ---
      log(`[Extension] Starting Akka component extraction from CST...`);

      const allAkkaComponents: Array<{
        filename: string;
        className: string;
        componentType: string;
        componentId: string;
      }> = [];

      for (const result of successfulParses) {
        if (result.cst) {
          const components = JavaParser.extractAkkaComponentsFromCST(result.cst, result.filename);
          allAkkaComponents.push(...components);

          log(`[Extension] File ${path.basename(result.filename)}: Found ${components.length} Akka components`);

          // Log each component for debugging
          components.forEach((component, index) => {
            log(`[Extension]   Component ${index + 1}: ${component.className} (${component.componentType}) - ID: ${component.componentId}`);
          });
        }
      }

      log(`[Extension] Found ${allAkkaComponents.length} Akka components across all files`);

      if (allAkkaComponents.length > 0) {
        allAkkaComponents.forEach((component, index) => {
          log(`[Extension]   Akka component ${index + 1}: ${component.className} (${component.componentType}) - ID: ${component.componentId}`);
        });
      }

      log(`[Extension] ========================================`);
      log(`[Extension] STARTING REGEX-BASED EDGE DETECTION`);
      log(`[Extension] ========================================`);
      log(`[Extension] Starting regex-based component detection...`);
      const parsedNodes = await parseNodes(javaFiles, outputChannel);
      const foundEdges = await parseEdges(parsedNodes, outputChannel);

      const aggregatedEdges = aggregateEdges(foundEdges);

      log(`[Extension] Regex parsing complete. Found ${parsedNodes.size} components and ${aggregatedEdges.length} edges`);

      // Log all found edges from regex parsing
      if (aggregatedEdges.length > 0) {
        log(`[RegEx] Found ${aggregatedEdges.length} edges from regex parsing:`);
        aggregatedEdges.forEach((edge, index) => {
          log(`[RegEx]   Edge ${index + 1}: ${edge.source} -> ${edge.target} (${edge.label})`);
          let detailsStr = edge.details && edge.details.length > 0 ? ` [Details: ${edge.details.join(', ')}]` : '';
          log(`[RegEx]   Edge ${index + 1}: ${edge.source} -> ${edge.target} (${edge.label})${detailsStr}`);
          if (edge.details && edge.details.length > 0) {
            log(`[RegEx]     Details: ${edge.details.join(', ')}`);
          }
        });
      } else {
        log(`[RegEx] No edges found from regex parsing`);
      }

      // --- CST-based Edge Detection ---
      log(`[Extension] ========================================`);
      log(`[Extension] STARTING CST-BASED EDGE DETECTION`);
      log(`[Extension] ========================================`);
      log(`[Extension] Starting CST-based edge detection...`);
      const cstEdges: AkkaEdge[] = [];

      for (const result of successfulParses) {
        if (result.cst) {
          log(`[Extension] Processing CST for file: ${path.basename(result.filename)}`);
          // Get the source text for the file
          const document = await vscode.workspace.openTextDocument(result.filename);
          const sourceText = document.getText();
          const connections = extractComponentConnectionsFromCST(result.cst, result.filename, sourceText);

          if (connections.length > 0) {
            log(`[Extension]   Found ${connections.length} connections in ${path.basename(result.filename)}:`);
            connections.forEach((conn, index) => {
              const edge: AkkaEdge = {
                source: conn.source,
                target: conn.target,
                label: conn.label,
                details: conn.details,
              };
              cstEdges.push(edge);
              log(`[Extension]     Connection ${index + 1}: ${conn.source} -> ${conn.target} (${conn.label})`);
              if (conn.details && conn.details.length > 0) {
                let detailsStr = conn.details && conn.details.length > 0 ? ` [Details: ${conn.details.join(', ')}]` : '';
                log(`[Extension]     Connection ${index + 1}: ${conn.source} -> ${conn.target} (${conn.label})${detailsStr}`);
                log(`[Extension]       Details: ${conn.details.join(', ')}`);
                // Add specific logging for method names
                if (conn.details.length > 0) {
                  log(`[Extension]       Method names: ${conn.details.join(', ')}`);
                }
              }
            });
          } else {
            log(`[Extension]   No connections found in ${path.basename(result.filename)}`);
          }
        }
      }

      log(`[Extension] CST-based edge detection complete. Found ${cstEdges.length} edges`);
      if (cstEdges.length > 0) {
        log(`[Extension] Found ${cstEdges.length} edges from CST-based detection:`);
        cstEdges.forEach((edge, index) => {
          let detailsStr = edge.details && edge.details.length > 0 ? ` [Details: ${edge.details.join(', ')}]` : '';
          log(`[Extension]   Edge ${index + 1}: ${edge.source} -> ${edge.target} (${edge.label})${detailsStr}`);
          // Add specific logging for method names
          if (edge.details && edge.details.length > 0) {
            log(`[Extension]     Method names: ${edge.details.join(', ')}`);
          }
        });
        log(`[Extension] CST-based edge detection ===== end edge lists. `);
      } else {
        log(`[Extension] No edges found from CST-based detection`);
      }

      // Combine edges from both methods with deduplication to prevent overlap
      log(`[Extension] ========================================`);
      log(`[Extension] COMBINING EDGES WITH DEDUPLICATION`);
      log(`[Extension] ========================================`);

      // Create a Set to track unique edges and prevent overlap
      const uniqueEdges = new Map<string, AkkaEdge>();

      // Helper function to create a unique key for an edge
      const createEdgeKey = (edge: AkkaEdge): string => {
        return `${edge.source}->${edge.target}->${edge.label}`;
      };

      // Add regex edges first
      log(`[Extension] Adding ${aggregatedEdges.length} regex edges to unique set`);
      aggregatedEdges.forEach((edge, index) => {
        const key = createEdgeKey(edge);
        if (!uniqueEdges.has(key)) {
          uniqueEdges.set(key, edge);
          log(`[Extension]   Added regex edge ${index + 1}: ${edge.source} -> ${edge.target} (${edge.label})`);
        } else {
          log(`[Extension]   Skipped duplicate regex edge ${index + 1}: ${edge.source} -> ${edge.target} (${edge.label})`);
        }
      });

      // Add CST edges, but skip if already present from regex
      log(`[Extension] Adding ${cstEdges.length} CST edges to unique set (skipping duplicates)`);
      cstEdges.forEach((edge, index) => {
        const key = createEdgeKey(edge);
        if (!uniqueEdges.has(key)) {
          uniqueEdges.set(key, edge);
          log(`[Extension]   Added CST edge ${index + 1}: ${edge.source} -> ${edge.target} (${edge.label})`);
          if (edge.details && edge.details.length > 0) {
            log(`[Extension]     Method names: ${edge.details.join(', ')}`);
          }
        } else {
          log(`[Extension]   Skipped duplicate CST edge ${index + 1}: ${edge.source} -> ${edge.target} (${edge.label}) - already found by regex`);
        }
      });

      const allEdges = Array.from(uniqueEdges.values());
      log(`[Extension] Deduplication complete. Final unique edges: ${allEdges.length} (${aggregatedEdges.length} from regex + ${cstEdges.length} from CST, with duplicates removed)`);

      // Log all final unique edges
      if (allEdges.length > 0) {
        log(`[Extension] Final unique edges found:`);
        log(`[Extension] Final unique edges found (${allEdges.length}):`);
        allEdges.forEach((edge, index) => {
          log(`[Extension]   Edge ${index + 1}: ${edge.source} -> ${edge.target} (${edge.label})`);
          let detailsStr = edge.details && edge.details.length > 0 ? ` [Details: ${edge.details.join(', ')}]` : '';
          log(`[Extension]   Edge ${index + 1}: ${edge.source} -> ${edge.target} (${edge.label})${detailsStr}`);
          if (edge.details && edge.details.length > 0) {
            log(`[Extension]     Details: ${edge.details.join(', ')}`);
            // Add specific logging for method names
            if (edge.details.length > 0) {
              log(`[Extension]     Method names: ${edge.details.join(', ')}`);
            }
          }
        });
        log(`[Extension] Final unique edges ===== end edge lists. `);
        log(`[Extension] Final unique edges ===== end edge lists. `);
      } else {
        log(`[Extension] No edges found in the project`);
        log(`[Extension] No edges found in the project`);
      }

      // --- Load saved layouts from workspace state ---
      const savedNodeLayout = context.workspaceState.get<{ [id: string]: { x: number; y: number } }>('akkaDiagramLayout', {});
      const savedViewState = context.workspaceState.get<ViewState>('akkaDiagramViewState', { panX: 0, panY: 0, scale: 1 });

      const nodesWithLayout = Array.from(parsedNodes.values()).map((node) => ({
        ...node,
        ...savedNodeLayout[node.id], // Apply saved coordinates if they exist
      }));

      const diagramData = { nodes: nodesWithLayout, edges: allEdges };

      // --- Create the Webview Panel ---
      if (diagramData.nodes.length > 0) {
        log(`[Extension] Creating diagram with ${diagramData.nodes.length} nodes and ${diagramData.edges.length} edges`);
        createDiagramPanel(context, diagramData, savedViewState);
      } else {
        vscode.window.showWarningMessage('No Akka components found in this project.');
        log(`[Extension] No Akka components found in the project`);
      }
    } catch (error) {
      console.error('[Extension] Error in command "akka-diagram-generator.scanProject"', error);
      log(`[Extension] ERROR: ${error}`);
      log(`[Extension] Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      vscode.window.showErrorMessage('An error occurred while scanning the project.');
    }
  });

  let clearLayoutDisposable = vscode.commands.registerCommand('akka-diagram-generator.clearLayout', async () => {
    const layout = context.workspaceState.get('akkaDiagramLayout', {});
    const viewState = context.workspaceState.get('akkaDiagramViewState', { panX: 0, panY: 0, scale: 1 });

    if (Object.keys(layout).length === 0 && viewState.panX === 0 && viewState.panY === 0 && viewState.scale === 1) {
      vscode.window.showInformationMessage('No saved diagram layout to clear.');
      return;
    }

    const result = await vscode.window.showWarningMessage(
      'Are you sure you want to clear the saved diagram layout? This will reset all custom node positions and view settings.',
      { modal: true },
      'Clear Layout',
      'Cancel'
    );

    if (result === 'Clear Layout') {
      context.workspaceState.update('akkaDiagramLayout', {});
      context.workspaceState.update('akkaDiagramViewState', { panX: 0, panY: 0, scale: 1 });
      vscode.window.showInformationMessage('Diagram layout cleared successfully. The next time you generate a diagram, it will use default positioning.');
    }
  });

  context.subscriptions.push(scanProjectDisposable, clearLayoutDisposable);
}

// --- Webview Panel Creation ---

function createDiagramPanel(context: vscode.ExtensionContext, data: { nodes: AkkaComponent[]; edges: AkkaEdge[] }, viewState: ViewState) {
  // Check if we already have an active diagram panel
  if (currentDiagramPanel) {
    // Update the existing panel with new data
    const serializableData: SerializableDiagramData = {
      nodes: data.nodes.map(({ id, name, type, x, y }) => ({ id, name, type, x, y })),
      edges: data.edges,
    };

    // Send the new data to the existing webview
    currentDiagramPanel.webview.postMessage({
      command: 'updateDiagram',
      payload: { data: serializableData, viewState },
    });

    // Reveal the existing panel
    currentDiagramPanel.reveal();
    return;
  }

  // Create a new panel if none exists
  const panel = vscode.window.createWebviewPanel('akkaDiagram', 'Akka Component Diagram', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });

  // Store the panel reference
  currentDiagramPanel = panel;

  // Handle panel disposal
  panel.onDidDispose(
    () => {
      currentDiagramPanel = undefined;
    },
    null,
    context.subscriptions
  );

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
