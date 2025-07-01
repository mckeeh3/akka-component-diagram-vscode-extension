import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface SerializableDiagramData {
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    x?: number;
    y?: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    label: string;
    details: string[];
  }>;
}

export interface ViewState {
  panX: number;
  panY: number;
  scale: number;
}

export function getWebviewContent(data: SerializableDiagramData, viewState: ViewState, extensionUri: vscode.Uri): string {
  // Read the HTML template
  const htmlPath = path.join(extensionUri.fsPath, 'src', 'webview', 'diagram.html');
  const jsPath = path.join(extensionUri.fsPath, 'src', 'webview', 'diagram.js');

  let htmlContent: string;
  let jsContent: string;

  try {
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
    jsContent = fs.readFileSync(jsPath, 'utf8');
  } catch (error) {
    console.error('Error reading webview files:', error);
    // Fallback to inline content if files can't be read
    return getFallbackWebviewContent(data, viewState);
  }

  // Convert the JavaScript file to a data URI for inline loading
  const jsDataUri = `data:text/javascript;charset=utf-8,${encodeURIComponent(jsContent)}`;

  // Replace the script src with the data URI
  const processedHtml = htmlContent.replace('src="diagram.js"', `src="${jsDataUri}"`);

  // Add the initialization script
  const dataJson = JSON.stringify(data);
  const viewStateJson = JSON.stringify(viewState);

  const initScript = `
    <script>
      // Initialize the diagram when the page loads
      document.addEventListener('DOMContentLoaded', function() {
        if (window.initializeDiagram) {
          window.initializeDiagram(${dataJson}, ${viewStateJson});
        }
      });
    </script>
  `;

  // Insert the initialization script before the closing body tag
  return processedHtml.replace('</body>', `${initScript}\n</body>`);
}

function getFallbackWebviewContent(data: SerializableDiagramData, viewState: ViewState): string {
  // This is the original inline content as a fallback
  const dataJson = JSON.stringify(data);
  const viewStateJson = JSON.stringify(viewState);

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Akka Flow Diagram</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Inter', sans-serif; margin: 0; padding: 0; overflow: hidden; cursor: grab; }
        body.panning { cursor: grabbing; }
        .node { border-radius: 8px; color: white; padding: 8px 12px; position: absolute; cursor: move; min-width: 180px; box-shadow: 0 4px 8px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); pointer-events: auto; user-select: none; }
        .node.selected { box-shadow: 0 0 0 3px #60A5FA; }
        .node-title { font-weight: 600; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.3); margin-bottom: 4px; text-align: center; }
        .node-type { font-size: 0.75rem; text-align: center; opacity: 0.8; }
        #diagram-root { position: relative; width: 100%; height: 100vh; }
        #viewport { position: absolute; transform-origin: 0 0; }
        #tooltip { position: fixed; background-color: #1f2937; color: white; border: 1px solid #4b5563; border-radius: 4px; padding: 8px; font-size: 12px; pointer-events: none; z-index: 100; max-width: 300px; }
        #tooltip ul { list-style-type: disc; margin-left: 16px; }
        #marquee { position: absolute; border: 1px solid #60A5FA; background-color: rgba(96, 165, 250, 0.2); pointer-events: none; z-index: 99; }
      </style>
    </head>
    <body class="bg-gray-700">
      <div id="diagram-root">
        <div id="viewport">
          <div id="node-container" style="position: relative; width: 100%; height: 100%;"></div>
          <canvas id="diagram-canvas" style="position: absolute; top: 0; left: 0; pointer-events: none;"></canvas>
          <div id="marquee" class="hidden"></div>
        </div>
      </div>
      <div id="tooltip" class="hidden"></div>
      <script>
        // Fallback JavaScript content would go here
        console.error('Webview files not found, using fallback content');
      </script>
    </body>
    </html>
  `;
}
