import * as vscode from 'vscode';

// Define types for our discovered components and their relationships
interface AkkaComponent {
	id: string; // The class name, used as a unique ID
	name: string; // The component name from the annotation (e.g., "customer")
	type: string; // e.g., "EventSourcedEntity", "HttpEndpoint"
	uri: vscode.Uri; // The URI of the file where the component is defined
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
			
			// New, more robust parsing strategy
			// 1. Find all `.method()` calls.
			// 2. Work backwards to verify they are from a componentClient.
			const methodCallRegex = /\.method\s*\(([\w:]+)\)/g;
			const clientCallRegex = /componentClient\.for(?:EventSourcedEntity|KeyValueEntity|View|Workflow|TimedAction)\(.*\)$/s;
			
			let match;
			while((match = methodCallRegex.exec(text)) !== null) {
				const methodRef = match[1];
				// Clean up multiline formatting that can break the regex
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

			// Consume annotations
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

			// Produce annotations
			while((match = produceRegex.exec(text)) !== null) {
				const [_, toType, toName] = match;
				if(!parsedNodes.has(toName)) {
					const topicUri = vscode.Uri.parse(`untitled:Topic/${toName}`);
					parsedNodes.set(toName, { id: toName, name: toName, type: toType, uri: topicUri});
				}
				foundEdges.push({ source: sourceNode.id, target: toName, label: 'produces to'});
			}
		}

		// De-duplicate edges to keep the diagram clean
		const uniqueEdges = foundEdges.filter((edge, index, self) =>
			index === self.findIndex((e) => (
				e.source === edge.source && e.target === edge.target && e.label === edge.label
			))
		);

		const diagramData: DiagramData = {
			nodes: Array.from(parsedNodes.values()),
			edges: uniqueEdges
		};

		// --- Step 3: Create the Webview Panel ---
		if (diagramData.nodes.length > 0) {
			createDiagramPanel(context.extensionUri, diagramData);
		} else {
			vscode.window.showWarningMessage('No Akka components found in this project.');
		}
	});

	context.subscriptions.push(scanProjectDisposable);
}


function createDiagramPanel(extensionUri: vscode.Uri, data: DiagramData) {
	const panel = vscode.window.createWebviewPanel(
		'akkaDiagram', // Identifies the type of the webview. Used internally
		'Akka Component Diagram', // Title of the panel displayed to the user
		vscode.ViewColumn.One, // Editor column to show the new webview panel in.
		{
			enableScripts: true // Enable javascript in the webview
		}
	);

	// Create a serializable version of the data by removing the vscode.Uri objects.
	const serializableData: SerializableDiagramData = {
		nodes: data.nodes.map(({ id, name, type }) => ({ id, name, type })),
		edges: data.edges
	};

	// Set the HTML content for the webview panel
	panel.webview.html = getWebviewContent(serializableData);
}

function getWebviewContent(data: SerializableDiagramData): string {
	// We'll inject the parsed data directly into the HTML for the webview's script to use.
	const dataJson = JSON.stringify(data);

	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Akka Flow Diagram</title>
			<script src="https://cdn.tailwindcss.com"></script>
			<script src="https://d3js.org/d3.v7.min.js"></script>
			<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
			<style>
				body {
					font-family: 'Inter', sans-serif;
					margin: 0;
					padding: 0;
					overflow: hidden;
				}
				.node {
					border-radius: 8px;
					color: white;
					padding: 8px 12px;
					position: absolute;
					cursor: move;
					min-width: 180px;
					box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
					border: 1px solid rgba(255, 255, 255, 0.2);
					pointer-events: auto;
				}
				.node-title {
					font-weight: 600;
					padding-bottom: 4px;
					border-bottom: 1px solid rgba(255, 255, 255, 0.3);
					margin-bottom: 4px;
					text-align: center;
				}
				.node-type {
					font-size: 0.75rem;
					text-align: center;
					opacity: 0.8;
				}
				.node-port {
					width: 12px;
					height: 12px;
					border: 1px solid #E2E8F0;
					border-radius: 50%;
					position: absolute;
					background-color: #A0AEC0;
					top: 50%;
					transform: translateY(-50%);
				}
				.port-in { left: -6px; }
				.port-out { right: -6px; }
				#canvas-container { pointer-events: none; }
			</style>
		</head>
		<body class="bg-gray-700">
			<div id="diagram-root" class="w-full h-screen relative">
				<canvas id="diagram-canvas" class="absolute inset-0"></canvas>
				<div id="node-container" class="absolute inset-0"></div>
			</div>

			<script>
				const diagramData = ${dataJson};
				const nodes = diagramData.nodes;
				const edges = diagramData.edges;

				const canvas = document.getElementById('diagram-canvas');
				const nodeContainer = document.getElementById('node-container');
				const ctx = canvas.getContext('2d');
				const diagramRoot = document.getElementById('diagram-root');
				
				const componentColors = {
					'HttpEndpoint': 'bg-purple-600',
					'GrpcEndpoint': 'bg-purple-700',
					'EventSourcedEntity': 'bg-green-600',
					'KeyValueEntity': 'bg-teal-600',
					'View': 'bg-blue-600',
					'Workflow': 'bg-orange-600',
					'Consumer': 'bg-yellow-600',
					'Topic': 'bg-gray-500',
					'ServiceStream': 'bg-gray-500',
					'Unknown': 'bg-gray-600'
				};
				
				// Create HTML elements for each node and bind data
				nodes.forEach(node => {
					const el = document.createElement('div');
					el.id = 'node-' + node.id;
					const colorClass = componentColors[node.type] || componentColors['Unknown'];
					el.className = 'node ' + colorClass;
					el.innerHTML = \`
						<div class="node-title">\${node.id}</div>
						<div class="node-type">\${node.name} (\${node.type})</div>
						<div class="node-port port-in"></div>
						<div class="node-port port-out"></div>
					\`;
					// FIX: Manually bind the node data object to the DOM element for D3
					el.__data__ = node;
					nodeContainer.appendChild(el);
					node.element = el;
				});


				// --- D3 Force Simulation ---
				const linkForce = d3.forceLink(edges)
					.id(d => d.id)
					.distance(300) // increase distance between nodes
					.strength(0.5);

				const simulation = d3.forceSimulation(nodes)
					.force("link", linkForce)
					.force("charge", d3.forceManyBody().strength(-2500)) // push nodes apart more strongly
					.force("center", d3.forceCenter(diagramRoot.clientWidth / 2, diagramRoot.clientHeight / 2))
					.on("tick", ticked);
				
				function ticked() {
					// Update HTML node positions
					nodes.forEach(node => {
						const el = node.element;
						// Keep nodes within the bounds of the container
						node.x = Math.max(0, Math.min(diagramRoot.clientWidth - el.offsetWidth, node.x));
						node.y = Math.max(0, Math.min(diagramRoot.clientHeight - el.offsetHeight, node.y));
						el.style.left = node.x + 'px';
						el.style.top = node.y + 'px';
					});
					
					// Redraw canvas edges
					drawEdges();
				}

				function drawEdges() {
					canvas.width = diagramRoot.clientWidth;
					canvas.height = diagramRoot.clientHeight;
					ctx.clearRect(0, 0, canvas.width, canvas.height);
					ctx.strokeStyle = '#A0AEC0';
					ctx.lineWidth = 2;
					ctx.fillStyle = '#E2E8F0';
					ctx.font = '11px Inter';
					ctx.textAlign = 'center';

					edges.forEach(edge => {
						const sourceNode = edge.source;
						const targetNode = edge.target;
						
						if (sourceNode && targetNode && sourceNode.element && targetNode.element) {
							const startX = sourceNode.x + sourceNode.element.offsetWidth;
							const startY = sourceNode.y + sourceNode.element.offsetHeight / 2;
							const endX = targetNode.x;
							const endY = targetNode.y + targetNode.element.offsetHeight / 2;
							
							const cp1x = startX + 60;
							const cp1y = startY;
							const cp2x = endX - 60;
							const cp2y = endY;
							
							ctx.beginPath();
							ctx.moveTo(startX, startY);
							ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
							ctx.stroke();

							const angle = Math.atan2(endY - cp2y, endX - cp2x);
							ctx.save();
							ctx.translate(endX, endY);
							ctx.rotate(angle);
							ctx.beginPath();
							ctx.moveTo(0, 0);
							ctx.lineTo(-10, -5);
							ctx.lineTo(-10, 5);
							ctx.closePath();
							ctx.fill();
							ctx.restore();

							if (edge.label) {
								const midX = (startX + endX) / 2;
								const midY = (startY + endY) / 2 - 10;
								ctx.save();
								ctx.fillStyle = '#CBD5E0';
								ctx.fillText(edge.label, midX, midY);
								ctx.restore();
							}
						}
					});
				}

				// --- Drag and Drop integration with D3 ---
				d3.selectAll(".node").call(d3.drag()
					.on("start", dragstarted)
					.on("drag", dragged)
					.on("end", dragended));

				function dragstarted(event, d) {
					if (!event.active) simulation.alphaTarget(0.3).restart();
					d.fx = d.x;
					d.fy = d.y;
				}

				function dragged(event, d) {
					d.fx = event.x;
					d.fy = event.y;
				}

				function dragended(event, d) {
					if (!event.active) simulation.alphaTarget(0);
					d.fx = null;
					d.fy = null;
				}
				
				window.addEventListener('resize', () => {
					simulation.force("center", d3.forceCenter(diagramRoot.clientWidth / 2, diagramRoot.clientHeight / 2));
					simulation.alpha(0.3).restart();
				});

			</script>
		</body>
		</html>
	`;
}


// This method is called when your extension is deactivated
export function deactivate() {}

