import * as vscode from 'vscode';
import * as path from 'path';

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

	let scanProjectDisposable = vscode.commands.registerCommand('akka-diagram-generator.scanProject', async (uri: vscode.Uri) => {
		
        let scanFolder: vscode.WorkspaceFolder | undefined;
        let relativePath: string;

        if (uri) {
            scanFolder = vscode.workspace.getWorkspaceFolder(uri);
            if (!scanFolder) {
                vscode.window.showErrorMessage("Selected file is not part of a workspace folder.");
                return;
            }
            relativePath = path.relative(scanFolder.uri.fsPath, uri.fsPath);
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            scanFolder = vscode.workspace.workspaceFolders[0];
            relativePath = '';
        } else {
            vscode.window.showErrorMessage("No folder open in workspace.");
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
		const savedNodeLayout = context.workspaceState.get<{[id: string]: {x: number, y: number}}>('akkaDiagramLayout', {});
        const savedViewState = context.workspaceState.get<ViewState>('akkaDiagramViewState', { panX: 0, panY: 0, scale: 1 });

		const nodesWithLayout = Array.from(parsedNodes.values()).map(node => ({
			...node,
			...savedNodeLayout[node.id] // Apply saved coordinates if they exist
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
            let componentType: string = (annotationType === 'ComponentId')
                ? extendedOrImplementedClass || 'Unknown'
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
        if (sourceNode.uri.scheme === 'untitled') continue;
        const document = await vscode.workspace.openTextDocument(sourceNode.uri);
        const text = document.getText();
        
        const methodCallRegex = /\.method\s*\(([\w:]+)\)/g;
        const clientCallRegex = /componentClient\.for(?:EventSourcedEntity|KeyValueEntity|View|Workflow|TimedAction)\(.*\)$/s;
        
        let match;
        while((match = methodCallRegex.exec(text)) !== null) {
            const methodRef = match[1];
            const cleanedPrecedingText = text.substring(0, match.index).replace(/\s*\n\s*/g, '');
            if (clientCallRegex.test(cleanedPrecedingText)) {
                const [targetClass, methodName] = methodRef.split('::');
                if(nodes.has(targetClass)) {
                    foundEdges.push({ source: sourceNode.id, target: targetClass, label: methodName, details: [] });
                }
            }
        }

        const consumeRegex = /@Consume\.From(EventSourcedEntity|KeyValueEntity|Workflow|Topic|ServiceStream)\((?:value\s*=\s*)?(?:(\w+)\.class|(?:"([^"]+)"))\)/g;
        const produceRegex = /@Produce\.To(Topic|ServiceStream)\("([^"]+)"\)/g;

        while((match = consumeRegex.exec(text)) !== null) {
            const [_, fromType, fromClass, fromString] = match;
            const consumeSource = fromClass || fromString;
            const detailLabel = fromType === 'Topic' || fromType === 'ServiceStream' ? 'consumes' : `${fromType} events`;
            if (!nodes.has(consumeSource)) {
                nodes.set(consumeSource, {id: consumeSource, name: consumeSource, type: fromType, uri: vscode.Uri.parse(`untitled:Topic/${consumeSource}`)});
            }
            foundEdges.push({ source: consumeSource, target: sourceNode.id, label: detailLabel, details: [] });
        }

        while((match = produceRegex.exec(text)) !== null) {
            const [_, toType, toName] = match;
            if(!nodes.has(toName)) {
                nodes.set(toName, { id: toName, name: toName, type: toType, uri: vscode.Uri.parse(`untitled:Topic/${toName}`)});
            }
            foundEdges.push({ source: sourceNode.id, target: toName, label: 'produces to', details: []});
        }
    }
    return foundEdges;
}

function aggregateEdges(edges: AkkaEdge[]): AkkaEdge[] {
    const edgeMap = new Map<string, AkkaEdge>();

    edges.forEach(edge => {
        const key = `${edge.source}->${edge.target}`;
        const existing = edgeMap.get(key);

        if(existing) {
            if(edge.label !== 'consumes' && edge.label !== 'produces to' && !existing.details.includes(edge.label)) {
                existing.details.push(edge.label);
            }
        } else {
            const newEdge: AkkaEdge = {
                source: edge.source,
                target: edge.target,
                label: '', // Will be set later
                details: []
            };
            if(edge.label !== 'consumes' && edge.label !== 'produces to') {
                newEdge.details.push(edge.label);
            }
            edgeMap.set(key, newEdge);
        }
    });

    return Array.from(edgeMap.values()).map(edge => {
        if(edge.details.length > 0) {
            edge.label = `invokes (${edge.details.length} methods)`;
        } else {
             // For consume/produce, we don't have method details
            const originalEdge = edges.find(e => e.source === edge.source && e.target === edge.target);
            edge.label = originalEdge ? originalEdge.label : '';
        }
        return edge;
    });
}


// --- Webview Panel Creation ---

function createDiagramPanel(context: vscode.ExtensionContext, data: { nodes: AkkaComponent[], edges: AkkaEdge[] }, viewState: ViewState) {
	const panel = vscode.window.createWebviewPanel('akkaDiagram', 'Akka Component Diagram', vscode.ViewColumn.One, { 
        enableScripts: true,
        retainContextWhenHidden: true
    });

	panel.webview.onDidReceiveMessage(
		async message => {
			switch (message.command) {
				case 'saveLayout':
					const currentLayout = context.workspaceState.get('akkaDiagramLayout', {});
					context.workspaceState.update('akkaDiagramLayout', { ...currentLayout, ...message.payload });
					return;
                case 'saveViewState':
                    context.workspaceState.update('akkaDiagramViewState', message.payload);
                    return;
				case 'navigateTo':
					const component = data.nodes.find(n => n.id === message.payload.componentId);
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
				#viewport { transform-origin: 0 0; }
                #tooltip { position: fixed; background-color: #1f2937; color: white; border: 1px solid #4b5563; border-radius: 4px; padding: 8px; font-size: 12px; pointer-events: none; z-index: 100; max-width: 300px; }
                #tooltip ul { list-style-type: disc; margin-left: 16px; }
			</style>
		</head>
		<body class="bg-gray-700">
			<div id="diagram-root" class="w-full h-screen relative">
                <div id="viewport">
				    <canvas id="diagram-canvas" class="absolute inset-0"></canvas>
				    <div id="node-container" class="absolute inset-0"></div>
                </div>
			</div>
            <div id="tooltip" class="hidden"></div>

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
                const tooltip = document.getElementById('tooltip');
				const ctx = canvas.getContext('2d');
				
				let draggingNode = null, dragOffsetX, dragOffsetY, dragHappened = false;
                let scale = initialViewState.scale, panX = initialViewState.panX, panY = initialViewState.panY;
                let isPanning = false, lastPanPosition = { x: 0, y: 0 };
                let edgeLabelHitboxes = [];

				const componentColors = { httpEndpoint: 'bg-purple-600', grpcEndpoint: 'bg-indigo-600', eventSourcedEntity: 'bg-green-600', keyValueEntity: 'bg-emerald-600', view: 'bg-blue-600', consumer: 'bg-yellow-600', workflow: 'bg-orange-600', timedAction: 'bg-rose-600', agent: 'bg-pink-600', topic: 'bg-slate-500', serviceStream: 'bg-slate-500', unknown: 'bg-sky-700' };

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
                    const typeKey = node.type.charAt(0).toLowerCase() + node.type.slice(1);
					const colorClass = componentColors[typeKey] || componentColors['unknown'];
					el.className = 'node ' + colorClass;
					el.style.left = node.x + 'px';
					el.style.top = node.y + 'px';
					el.innerHTML = \`<div class="node-title">\${node.id}</div><div class="node-type">\${node.name} (\${node.type})</div>\`;
					el.addEventListener('mousedown', onDragStart);
                    el.addEventListener('click', onNodeClick);
					nodeContainer.appendChild(el);
					node.element = el;
				}

				function drawEdges() {
                    const padding = 200;
                    let maxX = diagramRoot.clientWidth / scale; let maxY = diagramRoot.clientHeight / scale;
                    nodes.forEach(n => { if (n.x + 200 > maxX) maxX = n.x + 200; if (n.y + 100 > maxY) maxY = n.y + 100; });
                    canvas.width = maxX + padding; canvas.height = maxY + padding;
                    viewport.style.width = canvas.width + 'px'; viewport.style.height = canvas.height + 'px';

					ctx.clearRect(0, 0, canvas.width, canvas.height);
					ctx.strokeStyle = '#A0AEC0'; ctx.lineWidth = 2; ctx.fillStyle = '#E2E8F0';
					ctx.font = '11px Inter'; ctx.textAlign = 'center';
                    edgeLabelHitboxes = [];

					edges.forEach(edge => {
						const sourceNode = nodes.find(n => n.id === edge.source);
						const targetNode = nodes.find(n => n.id === edge.target);
						if (sourceNode && targetNode && sourceNode.element && targetNode.element) {
							const sElem = sourceNode.element; const tElem = targetNode.element;
							const startX = sElem.offsetLeft + sElem.offsetWidth; const startY = sElem.offsetTop + sElem.offsetHeight / 2;
							const endX = tElem.offsetLeft; const endY = tElem.offsetTop + tElem.offsetHeight / 2;
							const cp1x = startX + 60; const cp1y = startY; const cp2x = endX - 60; const cp2y = endY;
							
							ctx.beginPath(); ctx.moveTo(startX, startY); ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY); ctx.stroke();

							const angle = Math.atan2(endY - cp2y, endX - cp2x);
							ctx.save(); ctx.translate(endX, endY); ctx.rotate(angle);
							ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-10, -5); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill();
							ctx.restore();

							if (edge.label) {
								const midX = (startX + endX) / 2; const midY = (startY + endY) / 2 - 10;
								ctx.save(); ctx.fillStyle = '#CBD5E0'; ctx.fillText(edge.label, midX, midY); ctx.restore();
                                const textWidth = ctx.measureText(edge.label).width;
                                edgeLabelHitboxes.push({x: midX - textWidth / 2, y: midY - 10, width: textWidth, height: 20, edge: edge });
							}
						}
					});
				}

                function updateTransform() { viewport.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`; }
                function saveViewState() { vscode.postMessage({ command: 'saveViewState', payload: { panX, panY, scale } }); }
                function onNodeClick(e) { if (dragHappened) { e.stopPropagation(); return; } vscode.postMessage({ command: 'navigateTo', payload: { componentId: e.currentTarget.id.replace('node-', '') }}); }
				
				function onDragStart(e) {
					if (e.button !== 0) return;
					const nodeEl = e.target.closest('.node');
					if (!nodeEl) return;
					const id = nodeEl.id.replace('node-', '');
					draggingNode = nodes.find(n => n.id === id);
					if (draggingNode) {
                        dragHappened = false;
						dragOffsetX = e.clientX / scale - draggingNode.x;
						dragOffsetY = e.clientY / scale - draggingNode.y;
						document.addEventListener('mousemove', onDrag);
						document.addEventListener('mouseup', onDragEnd);
					}
				}

				function onDrag(e) {
					if (!draggingNode) return;
                    dragHappened = true;
					e.preventDefault();
					draggingNode.x = e.clientX / scale - dragOffsetX;
					draggingNode.y = e.clientY / scale - dragOffsetY;
					draggingNode.element.style.left = draggingNode.x + 'px';
					draggingNode.element.style.top = draggingNode.y + 'px';
					requestAnimationFrame(drawEdges);
				}

				function onDragEnd() {
					if (!draggingNode) return;
                    if (dragHappened) {
					    vscode.postMessage({ command: 'saveLayout', payload: { [draggingNode.id]: { x: draggingNode.x, y: draggingNode.y } } });
                    }
					draggingNode = null;
					document.removeEventListener('mousemove', onDrag);
					document.removeEventListener('mouseup', onDragEnd);
				}
				
                diagramRoot.addEventListener('wheel', e => {
                    e.preventDefault();
                    const zoomIntensity = 0.1; const direction = e.deltaY < 0 ? 1 : -1;
                    const oldScale = scale;
                    scale = Math.max(0.1, Math.min(4, scale + direction * zoomIntensity * scale));
                    const rect = diagramRoot.getBoundingClientRect();
                    const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
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
                        const dx = e.clientX - lastPanPosition.x; const dy = e.clientY - lastPanPosition.y;
                        panX += dx; panY += dy;
                        lastPanPosition = { x: e.clientX, y: e.clientY };
                        updateTransform();
                    } else {
                        // Tooltip logic
                        const rect = viewport.getBoundingClientRect();
                        const mouseX = (e.clientX - rect.left);
                        const mouseY = (e.clientY - rect.top);

                        let hoveredEdge = null;
                        for(const hitbox of edgeLabelHitboxes) {
                            if (mouseX >= hitbox.x * scale && mouseX <= (hitbox.x + hitbox.width) * scale &&
                                mouseY >= hitbox.y * scale && mouseY <= (hitbox.y + hitbox.height) * scale) {
                                hoveredEdge = hitbox.edge;
                                break;
                            }
                        }

                        if(hoveredEdge && hoveredEdge.details && hoveredEdge.details.length > 0) {
                            tooltip.innerHTML = '<ul>' + hoveredEdge.details.map(d => '<li>' + d + '</li>').join('') + '</ul>';
                            tooltip.style.left = (e.clientX + 15) + 'px';
                            tooltip.style.top = (e.clientY + 15) + 'px';
                            tooltip.classList.remove('hidden');
                        } else {
                            tooltip.classList.add('hidden');
                        }
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

