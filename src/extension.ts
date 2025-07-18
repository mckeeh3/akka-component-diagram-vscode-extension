import * as vscode from 'vscode';
import * as path from 'path';
import { getWebviewContent } from './webview/webviewManager';
import { JavaParser } from './parsers/javaParser';
import { extractComponentConnectionsFromCST } from './parsers/javaCstUtils';
import { AkkaComponent, AkkaEdge, SerializableDiagramData, ViewState } from './models/types';
import { createPrefixedLogger } from './utils/logger';
import { generateMermaidDiagram } from './utils/mermaidGenerator';
import { ComponentDiagramController } from './parsers/componentDiagramController';

// Helper function to aggregate CST edges
function aggregateCstEdges(edges: AkkaEdge[]): AkkaEdge[] {
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

// --- Type Definitions ---

// Global variable to track the existing diagram panel
let currentDiagramPanel: vscode.WebviewPanel | undefined;
let currentCstDiagramPanel: vscode.WebviewPanel | undefined;

// --- Helper Functions ---

/**
 * Find the exact location of a class in a Java file using CST parsing
 */
async function findClassLocation(className: string, fileUri: vscode.Uri, outputChannel?: vscode.OutputChannel): Promise<vscode.Position | null> {
  const log = createPrefixedLogger(outputChannel, '[Navigation]');

  try {
    log?.('Finding class location for:', className, 'in file:', fileUri.fsPath);

    // Parse the file using the Java parser
    const parseResult = await JavaParser.parseFile(fileUri, outputChannel);

    if (!parseResult.success || !parseResult.cst) {
      log?.('Failed to parse file for navigation');
      return null;
    }

    // Search for the class in the CST
    const classLocation = findClassInCST(parseResult.cst, className, log);

    if (classLocation) {
      log?.('Found class location:', classLocation);
      return classLocation;
    } else {
      log?.('Class not found in CST');
      return null;
    }
  } catch (error) {
    log?.('Error finding class location:', error);
    return null;
  }
}

/**
 * Recursively search for a class in the CST
 */
function findClassInCST(node: any, className: string, log?: any): vscode.Position | null {
  if (!node || typeof node !== 'object') return null;

  // Check if this is a class declaration node
  if (node.children && node.children.classDeclaration) {
    const classDecl = node.children.classDeclaration[0];
    if (classDecl.children && classDecl.children.normalClassDeclaration) {
      const normalClass = classDecl.children.normalClassDeclaration[0];
      if (normalClass.children && normalClass.children.identifier) {
        const identifier = normalClass.children.identifier[0];
        const foundClassName = identifier.image;

        log?.('Checking class:', foundClassName, 'against target:', className);

        if (foundClassName === className && identifier.location) {
          log?.('Found matching class:', className);
          return new vscode.Position(
            identifier.location.startLine - 1, // Convert to 0-based
            identifier.location.startColumn - 1 // Convert to 0-based
          );
        }
      }
    }
  }

  // Recursively search children
  if (node.children) {
    for (const [key, children] of Object.entries(node.children)) {
      if (Array.isArray(children)) {
        for (const child of children) {
          const result = findClassInCST(child, className, log);
          if (result) return result;
        }
      } else if (children && typeof children === 'object') {
        const result = findClassInCST(children, className, log);
        if (result) return result;
      }
    }
  }

  return null;
}

// --- Extension Activation ---

export function activate(context: vscode.ExtensionContext) {
  // Create output channel for debugging
  const outputChannel = vscode.window.createOutputChannel('Akka Diagram Generator');
  const log = createPrefixedLogger(outputChannel, '[Extension]');

  log('Congratulations, your extension "akka-diagram-generator" is now active!');
  log('Extension activation started');
  outputChannel.show(); // Make the output channel visible

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

  let generateCstDiagramDisposable = vscode.commands.registerCommand('akka-diagram-generator.generateCstDiagram', async (uri: vscode.Uri) => {
    // Use the shared logger
    const log = createPrefixedLogger(outputChannel, '[Extension]');

    try {
      log('========================================');
      log('COMMAND EXECUTED: akka-diagram-generator.generateCstDiagram');
      log('========================================');
      log('Command "akka-diagram-generator.generateCstDiagram" executed');

      let scanFolder: vscode.WorkspaceFolder | undefined;
      let relativePath: string;

      if (uri) {
        log(`URI provided: ${uri.fsPath}`);
        scanFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!scanFolder) {
          vscode.window.showErrorMessage('Selected file is not part of a workspace folder.');
          return;
        }
        relativePath = path.relative(scanFolder.uri.fsPath, uri.fsPath);
      } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        scanFolder = vscode.workspace.workspaceFolders[0];
        relativePath = '';
        log(`Using workspace folder: ${scanFolder.uri.fsPath}`);
      } else {
        vscode.window.showErrorMessage('No folder open in workspace.');
        return;
      }

      const pattern = new vscode.RelativePattern(path.join(scanFolder.uri.fsPath, relativePath), '**/*.java');
      log(`Searching for Java files with pattern: ${pattern.pattern}`);

      const javaFiles = await vscode.workspace.findFiles(pattern, '**/target/**');

      if (javaFiles.length === 0) {
        vscode.window.showWarningMessage('No Java files found in the selected folder.');
        log('No Java files found');
        return;
      }

      vscode.window.showInformationMessage(`Scanning ${javaFiles.length} Java file(s) for CST diagram...`);
      log(`Found ${javaFiles.length} Java files to scan for CST diagram`);

      // Use the controller for all processing steps
      log('========================================');
      log('USING COMPONENT DIAGRAM CONTROLLER FOR CST DIAGRAM');
      log('========================================');
      const controller = new ComponentDiagramController(outputChannel);
      const result = await controller.processProject(javaFiles);

      log(`Controller result: ${result.nodes.length} nodes, ${result.edges.length} edges`);
      result.nodes.forEach((node, i) => log(`  Node ${i + 1}: ${node.name} (${node.type})`));
      result.edges.forEach((edge, i) => log(`  Edge ${i + 1}: ${edge.source} -> ${edge.target} (${edge.label})`));

      // Load saved layouts from workspace state
      const savedCstNodeLayout = context.workspaceState.get<{ [id: string]: { x: number; y: number } }>('akkaCstDiagramLayout', {});
      const savedCstViewState = context.workspaceState.get<ViewState>('akkaCstDiagramViewState', { panX: 0, panY: 0, scale: 1 });

      // Apply saved layout to nodes
      const nodesWithLayout = result.nodes.map((node) => ({
        ...node,
        ...savedCstNodeLayout[node.id], // Apply saved coordinates if they exist
      }));

      const aggregatedEdges = aggregateCstEdges(result.edges);
      const cstDiagramData = { nodes: nodesWithLayout, edges: aggregatedEdges };

      // --- Create the CST Webview Panel ---
      if (cstDiagramData.nodes.length > 0) {
        log(`Creating CST diagram with ${cstDiagramData.nodes.length} nodes and ${cstDiagramData.edges.length} edges`);
        createCstDiagramPanel(context, cstDiagramData, savedCstViewState, outputChannel);
      } else {
        vscode.window.showWarningMessage('No Akka components found in this project.');
        log(`No Akka components found in the project`);
      }
    } catch (error) {
      log(`ERROR: ${error}`);
      log(`Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      vscode.window.showErrorMessage('An error occurred while generating the CST diagram.');
    }
  });

  let clearCstLayoutDisposable = vscode.commands.registerCommand('akka-diagram-generator.clearCstLayout', async () => {
    const layout = context.workspaceState.get('akkaCstDiagramLayout', {});
    const viewState = context.workspaceState.get('akkaCstDiagramViewState', { panX: 0, panY: 0, scale: 1 });

    if (Object.keys(layout).length === 0 && viewState.panX === 0 && viewState.panY === 0 && viewState.scale === 1) {
      vscode.window.showInformationMessage('No saved CST diagram layout to clear.');
      return;
    }

    const result = await vscode.window.showWarningMessage(
      'Are you sure you want to clear the saved CST diagram layout? This will reset all custom node positions and view settings.',
      { modal: true },
      'Clear Layout',
      'Cancel'
    );

    if (result === 'Clear Layout') {
      context.workspaceState.update('akkaCstDiagramLayout', {});
      context.workspaceState.update('akkaCstDiagramViewState', { panX: 0, panY: 0, scale: 1 });
      vscode.window.showInformationMessage('CST diagram layout cleared successfully. The next time you generate a diagram, it will use default positioning.');
    }
  });

  let generateMermaidDiagramDisposable = vscode.commands.registerCommand('akka-diagram-generator.generateMermaidDiagram', async () => {
    const log = createPrefixedLogger(outputChannel, '[Mermaid]');

    try {
      log('========================================');
      log('COMMAND EXECUTED: akka-diagram-generator.generateMermaidDiagram');
      log('========================================');

      // Check if there's an active markdown editor
      const activeEditor = vscode.window.activeTextEditor;
      let targetDocument: vscode.TextDocument | undefined;

      if (activeEditor && activeEditor.document.languageId === 'markdown') {
        targetDocument = activeEditor.document;
        log(`Using active markdown document: ${targetDocument.fileName}`);
      } else {
        // Prompt user to create or select a markdown file
        const result = await vscode.window.showInformationMessage(
          'No markdown file is currently open. Would you like to create a new markdown file for the Mermaid diagram?',
          'Create New File',
          'Select Existing File',
          'Cancel'
        );

        if (result === 'Create New File') {
          const fileName = await vscode.window.showInputBox({
            prompt: 'Enter the name for the markdown file (e.g., akka-diagram.md)',
            value: 'akka-diagram.md',
            placeHolder: 'akka-diagram.md',
          });

          if (!fileName) {
            log('User cancelled file creation');
            return;
          }

          // Create new markdown file
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
          }

          const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
          targetDocument = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(targetDocument);
          log(`Created new markdown file: ${fileUri.fsPath}`);
        } else if (result === 'Select Existing File') {
          const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
              'Markdown files': ['md', 'markdown'],
            },
          });

          if (uris && uris.length > 0) {
            targetDocument = await vscode.workspace.openTextDocument(uris[0]);
            await vscode.window.showTextDocument(targetDocument);
            log(`Selected existing markdown file: ${targetDocument.fileName}`);
          } else {
            log('User cancelled file selection');
            return;
          }
        } else {
          log('User cancelled operation');
          return;
        }
      }

      if (!targetDocument) {
        vscode.window.showErrorMessage('No target markdown file available.');
        return;
      }

      // Prompt for source folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return;
      }

      const sourceFolder = await vscode.window.showInputBox({
        prompt: 'Enter the path to scan for Java files (relative to workspace root)',
        value: 'src/main/java',
        placeHolder: 'src/main/java',
      });

      if (!sourceFolder) {
        log('User cancelled source folder input');
        return;
      }

      const scanPath = path.join(workspaceFolder.uri.fsPath, sourceFolder);
      log(`Scanning folder: ${scanPath}`);

      // Find Java files
      const pattern = new vscode.RelativePattern(scanPath, '**/*.java');
      const javaFiles = await vscode.workspace.findFiles(pattern, '**/target/**');

      if (javaFiles.length === 0) {
        vscode.window.showWarningMessage('No Java files found in the specified folder.');
        log('No Java files found');
        return;
      }

      vscode.window.showInformationMessage(`Scanning ${javaFiles.length} Java file(s) for Mermaid diagram...`);
      log(`Found ${javaFiles.length} Java files to scan`);

      // Parse Java files
      const parseResults = await JavaParser.parseFiles(javaFiles, outputChannel);
      const successfulParses = parseResults.filter((r) => r.success);

      if (successfulParses.length === 0) {
        vscode.window.showErrorMessage('Failed to parse any Java files.');
        return;
      }

      // Extract components and connections
      const allAkkaComponents: Array<{
        filename: string;
        className: string;
        componentType: string;
        componentId: string;
      }> = [];

      const allTopicNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];
      const allServiceStreamNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];
      const allToolNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];
      const cstEdges: AkkaEdge[] = [];

      for (const result of successfulParses) {
        if (result.cst) {
          // Extract components
          const components = JavaParser.extractAkkaComponentsFromCST(result.cst, result.filename);
          allAkkaComponents.push(...components);

          // Extract connections and nodes
          const document = await vscode.workspace.openTextDocument(result.filename);
          const sourceText = document.getText();
          const { connections, topicNodes, serviceStreamNodes, toolNodes } = extractComponentConnectionsFromCST(result.cst, result.filename, sourceText, outputChannel);

          // Add connections
          connections.forEach((conn) => {
            const edge: AkkaEdge = {
              source: conn.source,
              target: conn.target,
              label: conn.label,
              details: conn.details,
            };
            cstEdges.push(edge);
          });

          // Add topic and service stream nodes
          topicNodes.forEach((topic) => {
            if (!allTopicNodes.find((t) => t.id === topic.id)) {
              allTopicNodes.push(topic);
            }
          });

          serviceStreamNodes.forEach((stream: any) => {
            if (!allServiceStreamNodes.find((s) => s.id === stream.id)) {
              allServiceStreamNodes.push(stream);
            }
          });

          // Add tool nodes
          toolNodes.forEach((tool) => {
            if (!allToolNodes.find((t) => t.id === tool.id)) {
              allToolNodes.push(tool);
            }
          });
        }
      }

      // Convert to AkkaComponent format
      const cstNodes: AkkaComponent[] = allAkkaComponents.map((component) => ({
        id: component.className,
        name: component.componentId || component.className,
        type: component.componentType,
        uri: vscode.Uri.file(component.filename),
      }));

      const topicComponents: AkkaComponent[] = allTopicNodes.map((topic) => ({
        id: topic.id,
        name: topic.name,
        type: topic.type,
        uri: topic.uri,
      }));

      const serviceStreamComponents: AkkaComponent[] = allServiceStreamNodes.map((stream) => ({
        id: stream.id,
        name: stream.name,
        type: stream.type,
        uri: stream.uri,
      }));

      const toolComponents: AkkaComponent[] = allToolNodes.map((tool) => ({
        id: tool.id,
        name: tool.name,
        type: tool.type,
        uri: tool.uri,
      }));

      const allNodes = [...cstNodes, ...topicComponents, ...serviceStreamComponents, ...toolComponents];
      const aggregatedEdges = aggregateCstEdges(cstEdges);

      // Get theme from configuration
      const config = vscode.workspace.getConfiguration('akkaDiagramGenerator');
      const theme = config.get<string>('mermaidTheme', 'neutral') as 'default' | 'forest' | 'dark' | 'neutral';

      // Generate Mermaid diagram
      const mermaidContent = generateMermaidDiagram(allNodes, aggregatedEdges, {
        title: `Akka Component Diagram - ${path.basename(workspaceFolder.name)}`,
        direction: 'TB',
        theme: theme,
      });

      // Update the markdown document
      const edit = new vscode.WorkspaceEdit();
      edit.replace(targetDocument.uri, new vscode.Range(0, 0, targetDocument.lineCount, 0), mermaidContent);

      await vscode.workspace.applyEdit(edit);
      await targetDocument.save();

      vscode.window.showInformationMessage(`Mermaid diagram generated successfully with ${allNodes.length} components and ${aggregatedEdges.length} connections.`);

      log(`Mermaid diagram generated with ${allNodes.length} nodes and ${aggregatedEdges.length} edges`);
      log(`Diagram saved to: ${targetDocument.fileName}`);
    } catch (error) {
      log(`ERROR: ${error}`);
      log(`Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      vscode.window.showErrorMessage('An error occurred while generating the Mermaid diagram.');
    }
  });

  context.subscriptions.push(clearLayoutDisposable, generateCstDiagramDisposable, clearCstLayoutDisposable, generateMermaidDiagramDisposable);
}

// --- Webview Panel Creation ---

function createDiagramPanel(context: vscode.ExtensionContext, data: { nodes: AkkaComponent[]; edges: AkkaEdge[] }, viewState: ViewState, outputChannel?: vscode.OutputChannel) {
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
            try {
              // Use CST parsing to find the exact class location
              const classPosition = await findClassLocation(component.id, component.uri, outputChannel);

              if (classPosition) {
                const document = await vscode.workspace.openTextDocument(component.uri);
                const editor = await vscode.window.showTextDocument(document);

                // Set cursor position and reveal the class
                editor.selection = new vscode.Selection(classPosition, classPosition);
                editor.revealRange(new vscode.Range(classPosition, classPosition), vscode.TextEditorRevealType.InCenter);
              } else {
                // Fallback to simple regex if CST parsing fails
                const document = await vscode.workspace.openTextDocument(component.uri);
                const editor = await vscode.window.showTextDocument(document);

                const text = document.getText();
                const regex = new RegExp(`\\b(class|interface|enum)\\s+${component.id}\\b`);
                const match = text.match(regex);
                if (match && typeof match.index === 'number') {
                  const pos = document.positionAt(match.index);
                  editor.selection = new vscode.Selection(pos, pos);
                  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                }
              }
            } catch (error) {
              if (outputChannel) {
                const log = createPrefixedLogger(outputChannel, '[Navigation]');
                log(`Error navigating to component ${component.id}: ${error}`);
              }
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

// --- CST Diagram Panel Creation ---

function createCstDiagramPanel(context: vscode.ExtensionContext, data: { nodes: AkkaComponent[]; edges: AkkaEdge[] }, viewState: ViewState, outputChannel?: vscode.OutputChannel) {
  // Check if we already have an active CST diagram panel
  if (currentCstDiagramPanel) {
    // Update the existing panel with new data
    const serializableData: SerializableDiagramData = {
      nodes: data.nodes.map(({ id, name, type, x, y }) => ({ id, name, type, x, y })),
      edges: data.edges,
    };

    // Send the new data to the existing webview
    currentCstDiagramPanel.webview.postMessage({
      command: 'updateDiagram',
      payload: { data: serializableData, viewState },
    });

    // Reveal the existing panel
    currentCstDiagramPanel.reveal();
    return;
  }

  // Create a new panel if none exists
  const panel = vscode.window.createWebviewPanel('akkaCstDiagram', 'Akka Component Diagram', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });

  // Store the panel reference
  currentCstDiagramPanel = panel;

  // Handle panel disposal
  panel.onDidDispose(
    () => {
      currentCstDiagramPanel = undefined;
    },
    null,
    context.subscriptions
  );

  panel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'saveLayout':
          const currentLayout = context.workspaceState.get('akkaCstDiagramLayout', {});
          context.workspaceState.update('akkaCstDiagramLayout', { ...currentLayout, ...message.payload });
          return;
        case 'saveViewState':
          context.workspaceState.update('akkaCstDiagramViewState', message.payload);
          return;
        case 'navigateTo':
          const component = data.nodes.find((n) => n.id === message.payload.componentId);
          if (component && component.uri.scheme !== 'untitled') {
            try {
              // Use CST parsing to find the exact class location
              const classPosition = await findClassLocation(component.id, component.uri, outputChannel);

              if (classPosition) {
                const document = await vscode.workspace.openTextDocument(component.uri);
                const editor = await vscode.window.showTextDocument(document);

                // Set cursor position and reveal the class
                editor.selection = new vscode.Selection(classPosition, classPosition);
                editor.revealRange(new vscode.Range(classPosition, classPosition), vscode.TextEditorRevealType.InCenter);
              } else {
                // Fallback to simple regex if CST parsing fails
                const document = await vscode.workspace.openTextDocument(component.uri);
                const editor = await vscode.window.showTextDocument(document);

                const text = document.getText();
                const regex = new RegExp(`\\b(class|interface|enum)\\s+${component.id}\\b`);
                const match = text.match(regex);
                if (match && typeof match.index === 'number') {
                  const pos = document.positionAt(match.index);
                  editor.selection = new vscode.Selection(pos, pos);
                  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                }
              }
            } catch (error) {
              if (outputChannel) {
                const log = createPrefixedLogger(outputChannel, '[Navigation]');
                log(`Error navigating to component ${component.id}: ${error}`);
              }
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
