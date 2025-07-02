import * as vscode from 'vscode';
import * as path from 'path';
import { getWebviewContent } from './webview/webviewManager';
import { JavaParser } from './parsers/javaParser';
import { parseNodes, parseEdges, aggregateEdges } from './parsers/akkaParser';
import { AkkaComponent, AkkaEdge, SerializableDiagramData, ViewState } from './models/types';

// --- Type Definitions ---

// Global variable to track the existing diagram panel
let currentDiagramPanel: vscode.WebviewPanel | undefined;

// --- Extension Activation ---

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "akka-diagram-generator" is now active!');

  // Create output channel for debugging
  const outputChannel = vscode.window.createOutputChannel('Akka Diagram Generator');

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
    outputChannel.appendLine(`[Extension] Found ${javaFiles.length} Java files to scan`);

    // --- Java Parser Step ---
    console.log(`[Extension] Starting Java parser for ${javaFiles.length} files`);
    outputChannel.appendLine(`[Extension] Starting Java parser for ${javaFiles.length} files`);

    const parseResults = await JavaParser.parseFiles(javaFiles);

    // Count successes and failures
    const successfulParses = parseResults.filter((r) => r.success);
    const failedParses = parseResults.filter((r) => !r.success);

    console.log(`[Extension] Java parsing complete. Success: ${successfulParses.length}, Failures: ${failedParses.length}`);
    outputChannel.appendLine(`[Extension] Java parsing complete. Success: ${successfulParses.length}, Failures: ${failedParses.length}`);

    // Show user feedback
    if (failedParses.length > 0) {
      failedParses.forEach((result) => {
        vscode.window.showWarningMessage(`Failed to parse Java file: ${path.basename(result.filename)}`);
        outputChannel.appendLine(`[Extension] Parse failed: ${result.filename} - ${result.error}`);
      });
    }

    vscode.window.showInformationMessage(`Java parser: ${successfulParses.length} files parsed successfully, ${failedParses.length} failures`);

    // Debug: Log AST structure for first successful parse
    if (successfulParses.length > 0) {
      console.log(`[Extension] Debugging AST structure for: ${successfulParses[0].filename}`);
      outputChannel.appendLine(`[Extension] Debugging AST structure for: ${successfulParses[0].filename}`);
      JavaParser.debugAST(successfulParses[0].ast!);
    }

    // --- Extract Annotations from CST ---
    console.log(`[Extension] Starting annotation extraction from CST...`);
    outputChannel.appendLine(`[Extension] Starting annotation extraction from CST...`);

    const allAnnotations: Array<{
      filename: string;
      annotations: Array<{ name: string; arguments?: string[]; location?: any }>;
    }> = [];

    for (const result of successfulParses) {
      if (result.ast) {
        const annotations = JavaParser.extractAnnotationsFromCST(result.ast);
        allAnnotations.push({
          filename: result.filename,
          annotations,
        });

        console.log(`[Extension] File ${path.basename(result.filename)}: Found ${annotations.length} annotations`);
        outputChannel.appendLine(`[Extension] File ${path.basename(result.filename)}: Found ${annotations.length} annotations`);

        // Log each annotation for debugging
        annotations.forEach((annotation, index) => {
          const locationInfo = annotation.location ? `line ${annotation.location.startLine}, col ${annotation.location.startColumn}` : 'unknown location';

          console.log(`[Extension]   Annotation ${index + 1}: ${annotation.name} at ${locationInfo}`);
          outputChannel.appendLine(`[Extension]   Annotation ${index + 1}: ${annotation.name} at ${locationInfo}`);

          if (annotation.arguments && annotation.arguments.length > 0) {
            console.log(`[Extension]     Arguments: ${annotation.arguments.join(', ')}`);
            outputChannel.appendLine(`[Extension]     Arguments: ${annotation.arguments.join(', ')}`);
          }
        });
      }
    }

    // Look for Akka-specific annotations
    const akkaAnnotations = ['ComponentId', 'HttpEndpoint', 'GrpcEndpoint', 'MCPEndpoint'];
    const foundAkkaAnnotations = allAnnotations.flatMap((fileResult) => fileResult.annotations.filter((ann) => akkaAnnotations.includes(ann.name)));

    console.log(`[Extension] Found ${foundAkkaAnnotations.length} Akka-specific annotations across all files`);
    outputChannel.appendLine(`[Extension] Found ${foundAkkaAnnotations.length} Akka-specific annotations across all files`);

    if (foundAkkaAnnotations.length > 0) {
      foundAkkaAnnotations.forEach((annotation, index) => {
        console.log(`[Extension]   Akka annotation ${index + 1}: ${annotation.name}`);
        outputChannel.appendLine(`[Extension]   Akka annotation ${index + 1}: ${annotation.name}`);
        if (annotation.arguments && annotation.arguments.length > 0) {
          console.log(`[Extension]     Arguments: ${annotation.arguments.join(', ')}`);
          outputChannel.appendLine(`[Extension]     Arguments: ${annotation.arguments.join(', ')}`);
        }
      });
    }

    // --- Extract Akka Components from CST ---
    console.log(`[Extension] Starting Akka component extraction from CST...`);
    outputChannel.appendLine(`[Extension] Starting Akka component extraction from CST...`);

    const allAkkaComponents: Array<{
      filename: string;
      className: string;
      componentType: string;
      componentId: string;
    }> = [];

    for (const result of successfulParses) {
      if (result.ast) {
        const components = JavaParser.extractAkkaComponentsFromCST(result.ast, result.filename);
        allAkkaComponents.push(...components);

        console.log(`[Extension] File ${path.basename(result.filename)}: Found ${components.length} Akka components`);
        outputChannel.appendLine(`[Extension] File ${path.basename(result.filename)}: Found ${components.length} Akka components`);

        // Log each component for debugging
        components.forEach((component, index) => {
          console.log(`[Extension]   Component ${index + 1}: ${component.className} (${component.componentType}) - ID: ${component.componentId}`);
          outputChannel.appendLine(`[Extension]   Component ${index + 1}: ${component.className} (${component.componentType}) - ID: ${component.componentId}`);
        });
      }
    }

    console.log(`[Extension] Found ${allAkkaComponents.length} Akka components across all files`);
    outputChannel.appendLine(`[Extension] Found ${allAkkaComponents.length} Akka components across all files`);

    if (allAkkaComponents.length > 0) {
      allAkkaComponents.forEach((component, index) => {
        console.log(`[Extension]   Akka component ${index + 1}: ${component.className} (${component.componentType}) - ID: ${component.componentId}`);
        outputChannel.appendLine(`[Extension]   Akka component ${index + 1}: ${component.className} (${component.componentType}) - ID: ${component.componentId}`);
      });
    }

    outputChannel.appendLine(`[Extension] Starting regex-based component detection...`);
    const parsedNodes = await parseNodes(javaFiles, outputChannel);
    const foundEdges = await parseEdges(parsedNodes, outputChannel);

    const aggregatedEdges = aggregateEdges(foundEdges);

    outputChannel.appendLine(`[Extension] Regex parsing complete. Found ${parsedNodes.size} components and ${aggregatedEdges.length} edges`);

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
      outputChannel.appendLine(`[Extension] Creating diagram with ${diagramData.nodes.length} nodes and ${diagramData.edges.length} edges`);
      createDiagramPanel(context, diagramData, savedViewState);
    } else {
      vscode.window.showWarningMessage('No Akka components found in this project.');
      outputChannel.appendLine(`[Extension] No Akka components found in the project`);
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
