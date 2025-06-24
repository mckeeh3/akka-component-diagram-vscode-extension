import * as vscode from 'vscode';

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
}

// Data passed from the extension to the webview
interface SerializableDiagramData {
    nodes: Omit<AkkaComponent, 'uri'>[];
    edges: AkkaEdge[];
}

interface ViewState {
    panX: number;
    panY: number;
    scale: number;
}


// --- Extension Activation ---

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "akka-diagram-generator" is now active!');

	let scanProjectDisposable = vscode.commands.registerCommand('akka-diagram-generator.scanProject', async () => {
		
		const javaFiles = await vscode.workspace.findFiles('**/*.java', '**/node_modules/**');
		if (javaFiles.length === 0) {
			vscode.window.showWarningMessage('No Java files found in this project.');
			return;
		}

		vscode.window.showInformationMessage(`Scanning ${javaFiles.length} Java file(s)...`);
		
		const parsedNodes = await parseNodes(javaFiles);
		const foundEdges = await parseEdges(parsedNodes);

		// De-duplicate edges
		const uniqueEdges = foundEdges.filter((edge, index, self) =>
			index === self.findIndex((e) => (e.source === edge.source && e.target === edge.target && e.label === edge.label))
		);

		// --- Load saved layouts from workspace state ---
		const savedNodeLayout = context.workspaceState.get<{[id: string]: {x: number, y: number}}>('akkaDiagramLayout', {});
        const savedViewState = context.workspaceState.get<ViewState>('akkaDiagramViewState', { panX: 0, panY: 0, scale: 1 });

		const nodesWithLayout = Array.from(parsedNodes.values()).map(node => ({
			...node,
			...savedNodeLayout[node.id] // Apply saved coordinates if they exist
		}));

		const diagramData = { nodes: nodesWithLayout, edges: uniqueEdges };

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
        const componentRegex = /@(ComponentId|HttpEndpoint|GrpcEndpoint)(?:\("([^"]+)"\))?[\s\S]*?public\s+class\s+(\w+)(?:\s+(?:extends|implements)\s+([\w<>]+))?/g;
        
        let match;
        while ((match = componentRegex.exec(text)) !== null) {
            const [_, annotationType, componentId, className, extendedOrImplementedClass] = match;
            let componentType: string = (annotationType === 'ComponentId')
                ? extendedOrImplementedClass?.replace(/<.*>/, '') || 'Unknown'
                : annotationType;

            if (!parsedNodes.has(className)) {
                parsedNodes.set(className, { 
                    id: className, 
                    name: componentId || className, 
                    type: componentType,
                    uri: file 
                });
            }
        }
    }
    return parsedNodes;
}

async function parseEdges(nodes: Map<string, AkkaComponent>): Promise<AkkaEdge[]> {
    const foundEdges: AkkaEdge[] = [];
    for (const sourceNode of nodes.values()) {
        if (sourceNode.uri.scheme === 'untitled') continue; // Don't parse non-file URIs
        const document = await vscode.workspace.openTextDocument(sourceNode.uri);
        const text = document.getText();
        
        // Find component client calls
        const methodCallRegex = /\.method\s*\(([\w:]+)\)/g;
        const clientCallRegex = /componentClient\.for(?:EventSourcedEntity|KeyValueEntity|View|Workflow|TimedAction)\(.*\)$/s;
        
        let match;
        while((match = methodCallRegex.exec(text)) !== null) {
            const methodRef = match[1];
            const cleanedPrecedingText = text.substring(0, match.index).replace(/\s*\n\s*/g, '');
            if (clientCallRegex.test(cleanedPrecedingText)) {
                const targetClass = methodRef.split('::')[0];
                if(nodes.has(targetClass)) {
                    foundEdges.push({ source: sourceNode.id, target: targetClass, label: 'invoke' });
                }
            }
        }

        // Find consume/produce annotations
        const consumeRegex = /@Consume\.From(EventSourcedEntity|KeyValueEntity|Workflow|Topic|ServiceStream)\((?:value\s*=\s*)?(?:(\w+)\.class|(?:"([^"]+)"))\)/g;
        const produceRegex = /@Produce\.To(Topic|ServiceStream)\("([^"]+)"\)/g;

        while((match = consumeRegex.exec(text)) !== null) {
            const [_, fromType, fromClass, fromString] = match;
            const consumeSource = fromClass || fromString;
            if (!nodes.has(consumeSource)) {
                nodes.set(consumeSource, {id: consumeSource, name: consumeSource, type: fromType, uri: vscode.Uri.parse(`untitled:Topic/${consumeSource}`)});
            }
            foundEdges.push({ source: consumeSource, target: sourceNode.id, label: 'consumes' });
        }

        while((match = produceRegex.exec(text)) !== null) {
            const [_, toType, toName] = match;
            if(!nodes.has(toName)) {
                nodes.set(toName, { id: toName, name: toName, type: toType, uri: vscode.Uri.parse(`untitled:Topic/${toName}`)});
            }
            foundEdges.push({ source: sourceNode.id, target: toName, label: 'produces to'});
        }
    }
    return foundEdges;
}


// --- Webview Panel Creation ---

function createDiagramPanel(context: vscode.ExtensionContext, data: { nodes: AkkaComponent[], edges: AkkaEdge[] }, viewState: ViewState) {
	const panel = vscode.window.createWebviewPanel('akkaDiagram', 'Akka Component Diagram', vscode.ViewColumn.One, { enableScripts: true });

	panel.webview.onDidReceiveMessage(
		message => {
			switch (message.command) {
				case 'saveLayout':
					const currentLayout = context.workspaceState.get('akkaDiagramLayout', {});
					context.workspaceState.update('akkaDiagramLayout', { ...currentLayout, ...message.payload });
					return;
                case 'saveViewState':
                    context.workspaceState.update('akkaDiagramViewState', message.payload);
                    return;
			}
		},
		undefined,
		context.subscriptions
	);

	const serializableData: SerializableDiagramData = {
		nodes: data.nodes.map(({ id, name, type, x, y }) => ({ id, name, type, x, y })),
		edges: data.edges
	};

	panel.webview.html = getWebviewContent(serializableData, viewState);
}

function getWebviewContent(data: SerializableDiagramData, viewState: ViewState): string {
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
				.node { border-radius: 8px; color: white; padding: 8px 12px; position: absolute; cursor: move; min-width: 180px; box-shadow: 0 4px 8px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); pointer-events: auto; user-select: none; }
				.node-title { font-weight: 600; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.3); margin-bottom: 4px; text-align: center; }
				.node-type { font-size: 0.75rem; text-align: center; opacity: 0.8; }
				.node-port { width: 12px; height: 12px; border: 1px solid #E2E8F0; border-radius: 50%; position: absolute; background-color: #A0AEC0; top: 50%; transform: translateY(-50%); }
				.port-in { left: -6px; }
				.port-out { right: -6px; }
				#viewport { transform-origin: 0 0; }
			</style>
		</head>
		<body class="bg-gray-700">
			<div id="diagram-root" class="w-full h-screen relative">
                <div id="viewport">
				    <canvas id="diagram-canvas" class="absolute inset-0"></canvas>
				    <div id="node-container" class="absolute inset-0"></div>
                </div>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				const diagramData = ${dataJson};
				const initialViewState = ${viewStateJson};
				const nodes = diagramData.nodes;
				const edges = diagramData.edges;

				const canvas = document.getElementById('diagram-canvas');
				const nodeContainer = document.getElementById('node-container');
                const viewport = document.getElementById('viewport');
                const diagramRoot = document.getElementById('diagram-root');
				const ctx = canvas.getContext('2d');
				
				let draggingNode = null;
				let dragOffsetX, dragOffsetY;

                let scale = initialViewState.scale;
                let panX = initialViewState.panX;
                let panY = initialViewState.panY;
                let isPanning = false;
                let lastPanPosition = { x: 0, y: 0 };

				const componentColors = { 'HttpEndpoint': 'bg-purple-600', 'GrpcEndpoint': 'bg-purple-700', 'EventSourcedEntity': 'bg-green-600', 'KeyValueEntity': 'bg-teal-600', 'View': 'bg-blue-600', 'Workflow': 'bg-orange-600', 'Consumer': 'bg-yellow-600', 'Topic': 'bg-gray-500', 'ServiceStream': 'bg-gray-500', 'Unknown': 'bg-gray-600' };

				function render() {
					nodeContainer.innerHTML = '';
					nodes.forEach((node, index) => {
						node.x = node.x !== undefined ? node.x : 50;
						node.y = node.y !== undefined ? node.y : 50 + index * 40;
						createNodeElement(node);
					});
                    updateTransform();
					drawEdges();
				}

				function createNodeElement(node) {
					const el = document.createElement('div');
					el.id = 'node-' + node.id;
					const colorClass = componentColors[node.type] || componentColors['Unknown'];
					el.className = 'node ' + colorClass;
					el.style.left = node.x + 'px';
					el.style.top = node.y + 'px';
					el.innerHTML = \`
						<div class="node-title">\${node.id}</div>
						<div class="node-type">\${node.name} (\${node.type})</div>
						<div class="node-port port-in"></div>
						<div class="node-port port-out"></div>
					\`;
					el.addEventListener('mousedown', onDragStart);
					nodeContainer.appendChild(el);
					node.element = el;
				}

				function drawEdges() {
                    const padding = 200;
                    let maxX = diagramRoot.clientWidth / scale; // Start with viewport size
                    let maxY = diagramRoot.clientHeight / scale;
                    nodes.forEach(n => {
                        if (n.x + 200 > maxX) maxX = n.x + 200;
                        if (n.y + 100 > maxY) maxY = n.y + 100;
                    });
                    canvas.width = maxX + padding;
                    canvas.height = maxY + padding;
                    viewport.style.width = canvas.width + 'px';
                    viewport.style.height = canvas.height + 'px';

					ctx.clearRect(0, 0, canvas.width, canvas.height);
					ctx.strokeStyle = '#A0AEC0';
					ctx.lineWidth = 2;
					ctx.fillStyle = '#E2E8F0';
					ctx.font = '11px Inter';
					ctx.textAlign = 'center';

					edges.forEach(edge => {
						const sourceNode = nodes.find(n => n.id === edge.source);
						const targetNode = nodes.find(n => n.id === edge.target);
						if (sourceNode && targetNode && sourceNode.element && targetNode.element) {
							const sourceElem = sourceNode.element;
							const targetElem = targetNode.element;
							const startX = sourceElem.offsetLeft + sourceElem.offsetWidth;
							const startY = sourceElem.offsetTop + sourceElem.offsetHeight / 2;
							const endX = targetElem.offsetLeft;
							const endY = targetElem.offsetTop + targetElem.offsetHeight / 2;
							const cp1x = startX + 60; const cp1y = startY;
							const cp2x = endX - 60; const cp2y = endY;
							
							ctx.beginPath();
							ctx.moveTo(startX, startY);
							ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
							ctx.stroke();

							const angle = Math.atan2(endY - cp2y, endX - cp2x);
							ctx.save(); ctx.translate(endX, endY); ctx.rotate(angle);
							ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-10, -5); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill();
							ctx.restore();

							if (edge.label) {
								const midX = (startX + endX) / 2; const midY = (startY + endY) / 2 - 10;
								ctx.save(); ctx.fillStyle = '#CBD5E0'; ctx.fillText(edge.label, midX, midY); ctx.restore();
							}
						}
					});
				}

                function updateTransform() {
                    viewport.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`;
                }

                function saveViewState() {
                    vscode.postMessage({ command: 'saveViewState', payload: { panX, panY, scale } });
                }
				
				function onDragStart(e) {
					if (e.button !== 0) return; // Only drag with left mouse button
					const nodeEl = e.target.closest('.node');
					if (!nodeEl) return;
					const id = nodeEl.id.replace('node-', '');
					draggingNode = nodes.find(n => n.id === id);
					if (draggingNode) {
						dragOffsetX = e.clientX / scale - draggingNode.x;
						dragOffsetY = e.clientY / scale - draggingNode.y;
						document.addEventListener('mousemove', onDrag);
						document.addEventListener('mouseup', onDragEnd);
					}
				}

				function onDrag(e) {
					if (!draggingNode) return;
					e.preventDefault();
					draggingNode.x = e.clientX / scale - dragOffsetX;
					draggingNode.y = e.clientY / scale - dragOffsetY;
					draggingNode.element.style.left = draggingNode.x + 'px';
					draggingNode.element.style.top = draggingNode.y + 'px';
					requestAnimationFrame(drawEdges);
				}

				function onDragEnd() {
					if (!draggingNode) return;
					vscode.postMessage({ command: 'saveLayout', payload: { [draggingNode.id]: { x: draggingNode.x, y: draggingNode.y } } });
					draggingNode = null;
					document.removeEventListener('mousemove', onDrag);
					document.removeEventListener('mouseup', onDragEnd);
				}
				
                diagramRoot.addEventListener('wheel', e => {
                    e.preventDefault();
                    const zoomIntensity = 0.1;
                    const direction = e.deltaY < 0 ? 1 : -1;
                    const oldScale = scale;
                    scale = Math.max(0.1, Math.min(4, scale + direction * zoomIntensity * scale));
                    const rect = diagramRoot.getBoundingClientRect();
                    const mouseX = e.clientX - rect.left;
                    const mouseY = e.clientY - rect.top;
                    panX = mouseX - (mouseX - panX) * (scale / oldScale);
                    panY = mouseY - (mouseY - panY) * (scale / oldScale);
                    updateTransform();
                    saveViewState();
                });

                diagramRoot.addEventListener('mousedown', e => {
                    if (e.button === 1) { // Middle mouse button
                        isPanning = true;
                        lastPanPosition = { x: e.clientX, y: e.clientY };
                        diagramRoot.style.cursor = 'grabbing';
                    }
                });

                diagramRoot.addEventListener('mousemove', e => {
                    if (isPanning) {
                        const dx = e.clientX - lastPanPosition.x;
                        const dy = e.clientY - lastPanPosition.y;
                        panX += dx;
                        panY += dy;
                        lastPanPosition = { x: e.clientX, y: e.clientY };
                        updateTransform();
                    }
                });

                window.addEventListener('mouseup', e => {
                     if (isPanning) {
                        isPanning = false;
                        diagramRoot.style.cursor = 'grab';
                        saveViewState();
                    }
                });

				window.addEventListener('resize', drawEdges);
				render();
			</script>
		</body>
		</html>
	`;
}


export function deactivate() {}

