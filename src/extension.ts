import * as vscode from 'vscode';

// Define types for our discovered components and their relationships
interface AkkaComponent {
	id: string; // The class name, used as a unique ID
	name: string; // The component name from the annotation (e.g., "customer")
	type: string; // e.g., "EventSourcedEntity", "HttpEndpoint"
	uri: vscode.Uri; // The URI of the file where the component is defined
	x?: number; // Optional X coordinate for layout
	y?: number; // Optional Y coordinate for layout
}

interface AkkaEdge {
	source: string; // Source class name
	target: string; // Target class name
	label: string;
}

// A version of AkkaComponent that is safe to serialize to JSON for the webview
type SerializableAkkaComponent = Omit<AkkaComponent, 'uri'>;

interface DiagramData {
	nodes: AkkaComponent[];
	edges: AkkaEdge[];
}

interface SerializableDiagramData {
    nodes: SerializableAkkaComponent[];
    edges: AkkaEdge[];
}


export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "akka-diagram-generator" is now active!');

	// Register the "Scan Project" command
	let scanProjectDisposable = vscode.commands.registerCommand('akka-diagram-generator.scanProject', async () => {
		
		const javaFiles = await vscode.workspace.findFiles('**/*.java', '**/node_modules/**');
		if (javaFiles.length === 0) {
			vscode.window.showWarningMessage('No Java files found in this project.');
			return;
		}

		vscode.window.showInformationMessage(`Scanning ${javaFiles.length} Java file(s)...`);
		
		const parsedNodes = new Map<string, AkkaComponent>();

		// --- PASS 1: Find all component definitions (nodes) ---
		for (const file of javaFiles) {
			const document = await vscode.workspace.openTextDocument(file);
			const text = document.getText();
			
			const componentRegex = /@(ComponentId|HttpEndpoint|GrpcEndpoint)(?:\("([^"]+)"\))?[\s\S]*?public\s+class\s+(\w+)(?:\s+(?:extends|implements)\s+([\w<>]+))?/g;
			
			let match;
			while ((match = componentRegex.exec(text)) !== null) {
				const [_, annotationType, componentId, className, extendedOrImplementedClass] = match;
				
				let componentType: string;
				if (annotationType === 'ComponentId') {
					componentType = extendedOrImplementedClass?.replace(/<.*>/, '') || 'Unknown';
				} else {
					componentType = annotationType;
				}

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

		const foundEdges: AkkaEdge[] = [];

		// --- PASS 2: Find all interactions (edges) by iterating through known components ---
		for (const sourceNode of parsedNodes.values()) {
			const document = await vscode.workspace.openTextDocument(sourceNode.uri);
			const text = document.getText();
			
			const methodCallRegex = /\.method\s*\(([\w:]+)\)/g;
			const clientCallRegex = /componentClient\.for(?:EventSourcedEntity|KeyValueEntity|View|Workflow|TimedAction)\(.*\)$/s;
			
			let match;
			while((match = methodCallRegex.exec(text)) !== null) {
				const methodRef = match[1];
                const cleanedPrecedingText = text.substring(0, match.index).replace(/\s*\n\s*/g, '');
				
				if (clientCallRegex.test(cleanedPrecedingText)) {
					const targetClass = methodRef.split('::')[0];
					if(parsedNodes.has(targetClass)) {
						foundEdges.push({
							source: sourceNode.id,
							target: targetClass,
							label: 'invoke'
						});
					}
				}
			}

			const consumeRegex = /@Consume\.From(EventSourcedEntity|KeyValueEntity|Workflow|Topic|ServiceStream)\((?:value\s*=\s*)?(?:(\w+)\.class|(?:"([^"]+)"))\)/g;
			const produceRegex = /@Produce\.To(Topic|ServiceStream)\("([^"]+)"\)/g;

			while((match = consumeRegex.exec(text)) !== null) {
				const [_, fromType, fromClass, fromString] = match;
				const consumeSource = fromClass || fromString;

				if (fromType === 'Topic' || fromType === 'ServiceStream') {
					if (!parsedNodes.has(consumeSource)) {
						const topicUri = vscode.Uri.parse(`untitled:Topic/${consumeSource}`);
						parsedNodes.set(consumeSource, {id: consumeSource, name: consumeSource, type: fromType, uri: topicUri});
					}
					foundEdges.push({ source: consumeSource, target: sourceNode.id, label: 'consumes' });
				} else if (parsedNodes.has(consumeSource)) {
					foundEdges.push({ source: consumeSource, target: sourceNode.id, label: `${fromType} events` });
				}
			}

			while((match = produceRegex.exec(text)) !== null) {
				const [_, toType, toName] = match;
				if(!parsedNodes.has(toName)) {
					const topicUri = vscode.Uri.parse(`untitled:Topic/${toName}`);
					parsedNodes.set(toName, { id: toName, name: toName, type: toType, uri: topicUri});
				}
				foundEdges.push({ source: sourceNode.id, target: toName, label: 'produces to'});
			}
		}

		// De-duplicate edges
		const uniqueEdges = foundEdges.filter((edge, index, self) =>
			index === self.findIndex((e) => (
				e.source === edge.source && e.target === edge.target && e.label === edge.label
			))
		);

		// --- Load saved layout from workspace state ---
		const savedLayout = context.workspaceState.get<{[id: string]: {x: number, y: number}}>('akkaDiagramLayout', {});
		const nodesWithLayout = Array.from(parsedNodes.values()).map(node => ({
			...node,
			...savedLayout[node.id] // Apply saved coordinates if they exist
		}));

		const diagramData: DiagramData = {
			nodes: nodesWithLayout,
			edges: uniqueEdges
		};

		// --- Step 3: Create the Webview Panel ---
		if (diagramData.nodes.length > 0) {
			createDiagramPanel(context, diagramData);
		} else {
			vscode.window.showWarningMessage('No Akka components found in this project.');
		}
	});

	context.subscriptions.push(scanProjectDisposable);
}


function createDiagramPanel(context: vscode.ExtensionContext, data: DiagramData) {
	const panel = vscode.window.createWebviewPanel(
		'akkaDiagram', 
		'Akka Component Diagram',
		vscode.ViewColumn.One, 
		{ enableScripts: true }
	);

	// Handle messages from the webview to save layout
	panel.webview.onDidReceiveMessage(
		message => {
			switch (message.command) {
				case 'saveLayout':
					const currentLayout = context.workspaceState.get('akkaDiagramLayout', {});
					const newLayout = { ...currentLayout, ...message.payload };
					context.workspaceState.update('akkaDiagramLayout', newLayout);
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

	panel.webview.html = getWebviewContent(serializableData);
}

function getWebviewContent(data: SerializableDiagramData): string {
	const dataJson = JSON.stringify(data);

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
				const nodes = diagramData.nodes;
				const edges = diagramData.edges;

				const canvas = document.getElementById('diagram-canvas');
				const nodeContainer = document.getElementById('node-container');
                const viewport = document.getElementById('viewport');
                const diagramRoot = document.getElementById('diagram-root');
				const ctx = canvas.getContext('2d');
				
				let draggingNode = null;
				let dragOffsetX, dragOffsetY;

                let scale = 1;
                let panX = 0;
                let panY = 0;
                let isPanning = false;
                let lastPanPosition = { x: 0, y: 0 };

				const componentColors = { 'HttpEndpoint': 'bg-purple-600', 'GrpcEndpoint': 'bg-purple-700', 'EventSourcedEntity': 'bg-green-600', 'KeyValueEntity': 'bg-teal-600', 'View': 'bg-blue-600', 'Workflow': 'bg-orange-600', 'Consumer': 'bg-yellow-600', 'Topic': 'bg-gray-500', 'ServiceStream': 'bg-gray-500', 'Unknown': 'bg-gray-600' };

				function render() {
					nodeContainer.innerHTML = '';
					nodes.forEach((node, index) => {
						// Use saved coordinates, or place new nodes in a default spot
						node.x = node.x !== undefined ? node.x : 50;
						node.y = node.y !== undefined ? node.y : 50 + index * 40;
						createNodeElement(node);
					});
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
                    // Make canvas large enough to contain all content, then let CSS scale it
                    const padding = 200;
                    let maxX = 0, maxY = 0;
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
							const cp1x = startX + 60;
							const cp1y = startY;
							const cp2x = endX - 60;
							const cp2y = endY;
							
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
				
				function onDragStart(e) {
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
					const layoutToSave = { [draggingNode.id]: { x: draggingNode.x, y: draggingNode.y } };
					vscode.postMessage({ command: 'saveLayout', payload: layoutToSave });
					draggingNode = null;
					document.removeEventListener('mousemove', onDrag);
					document.removeEventListener('mouseup', onDragEnd);
				}
				
                // --- Pan and Zoom Handlers ---
                diagramRoot.addEventListener('wheel', e => {
                    e.preventDefault();
                    const zoomIntensity = 0.1;
                    const direction = e.deltaY < 0 ? 1 : -1;
                    const oldScale = scale;
                    scale += direction * zoomIntensity * scale;
                    scale = Math.max(0.1, Math.min(4, scale));

                    const rect = diagramRoot.getBoundingClientRect();
                    const mouseX = e.clientX - rect.left;
                    const mouseY = e.clientY - rect.top;

                    panX = mouseX - (mouseX - panX) * (scale / oldScale);
                    panY = mouseY - (mouseY - panY) * (scale / oldScale);

                    updateTransform();
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
                    }
                });

				window.addEventListener('resize', drawEdges);
				render();
			</script>
		</body>
		</html>
	`;
}


// This method is called when your extension is deactivated
export function deactivate() {}

