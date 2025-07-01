const vscode = acquireVsCodeApi();

// Global variables
let diagramData, initialViewState, nodes, edges;
let draggingNode = null,
  dragOffsetX,
  dragOffsetY,
  dragHappened = false;
let scale = 1,
  panX = 0,
  panY = 0;
let isPanning = false,
  lastPanPosition = { x: 0, y: 0 };
let isMarqueeSelecting = false,
  marqueeStartX,
  marqueeStartY;
let edgeLabelHitboxes = [];
const selectedNodes = new Set();
let initialDragPositions = new Map();

// DOM elements
const canvas = document.getElementById('diagram-canvas');
const nodeContainer = document.getElementById('node-container');
const viewport = document.getElementById('viewport');
const diagramRoot = document.getElementById('diagram-root');
const tooltip = document.getElementById('tooltip');
const marquee = document.getElementById('marquee');
const ctx = canvas.getContext('2d');

// Component color mapping
const componentColors = {
  httpEndpoint: 'bg-purple-600',
  grpcEndpoint: 'bg-indigo-600',
  eventSourcedEntity: 'bg-green-600',
  keyValueEntity: 'bg-emerald-600',
  view: 'bg-blue-600',
  consumer: 'bg-yellow-600',
  workflow: 'bg-orange-600',
  timedAction: 'bg-rose-600',
  agent: 'bg-pink-600',
  topic: 'bg-slate-500',
  serviceStream: 'bg-slate-500',
  unknown: 'bg-sky-700',
};

// Initialize the diagram
function initializeDiagram(data, viewState) {
  diagramData = data;
  initialViewState = viewState;
  nodes = diagramData.nodes;
  edges = diagramData.edges;

  scale = initialViewState.scale;
  panX = initialViewState.panX;
  panY = initialViewState.panY;

  render();
  setupEventListeners();
}

function render() {
  nodeContainer.innerHTML = '';
  nodes.forEach((node, index) => {
    node.x = node.x !== undefined ? node.x : 50;
    node.y = node.y !== undefined ? node.y : 50 + index * 40;
    createNodeElement(node);
  });
  updateTransform();
  requestAnimationFrame(drawEdges);
}

function createNodeElement(node) {
  const el = document.createElement('div');
  el.id = 'node-' + node.id;
  const typeKey = node.type.charAt(0).toLowerCase() + node.type.slice(1);
  const colorClass = componentColors[typeKey] || componentColors['unknown'];
  el.className = 'node ' + colorClass;
  el.innerHTML = `<div class="node-title">${node.id}</div><div class="node-type">${node.name} (${node.type})</div>`;
  el.addEventListener('mousedown', onDragStart);
  el.addEventListener('click', onNodeClick);
  nodeContainer.appendChild(el);
  node.element = el;
}

function drawEdges() {
  const padding = 200;
  let minX = 0,
    minY = 0,
    maxX = 0,
    maxY = 0;

  if (nodes.length > 0) {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    nodes.forEach((n) => {
      const nodeWidth = n.element ? n.element.offsetWidth : 180;
      const nodeHeight = n.element ? n.element.offsetHeight : 60;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + nodeWidth > maxX) maxX = n.x + nodeWidth;
      if (n.y + nodeHeight > maxY) maxY = n.y + nodeHeight;
    });
  }

  const worldWidth = maxX - minX;
  const worldHeight = maxY - minY;

  canvas.style.left = `${minX - padding}px`;
  canvas.style.top = `${minY - padding}px`;
  canvas.width = worldWidth + padding * 2;
  canvas.height = worldHeight + padding * 2;

  nodes.forEach((n) => {
    n.element.style.left = `${n.x}px`;
    n.element.style.top = `${n.y}px`;
  });

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-minX + padding, -minY + padding);
  ctx.strokeStyle = '#A0AEC0';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '11px Inter';
  ctx.textAlign = 'center';
  edgeLabelHitboxes = [];

  edges.forEach((edge) => {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
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
        const textWidth = ctx.measureText(edge.label).width;
        edgeLabelHitboxes.push({
          x: midX - textWidth / 2,
          y: midY - 10,
          width: textWidth,
          height: 20,
          edge: edge,
        });
      }
    }
  });
  ctx.restore();
}

function updateTransform() {
  viewport.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
}

function saveViewState() {
  vscode.postMessage({ command: 'saveViewState', payload: { panX, panY, scale } });
}

function clearSelection() {
  if (selectedNodes.size > 0) {
    selectedNodes.forEach((sid) => {
      const nodeEl = document.getElementById('node-' + sid);
      if (nodeEl) {
        nodeEl.classList.remove('selected');
      }
    });
    selectedNodes.clear();
  }
}

function onNodeClick(e) {
  if (dragHappened) {
    return;
  }
  const nodeEl = e.currentTarget;
  const nodeId = nodeEl.id.replace('node-', '');

  if (e.shiftKey) {
    e.stopPropagation();
    if (selectedNodes.has(nodeId)) {
      selectedNodes.delete(nodeId);
      nodeEl.classList.remove('selected');
    } else {
      selectedNodes.add(nodeId);
      nodeEl.classList.add('selected');
    }
  } else {
    if (selectedNodes.size <= 1) {
      vscode.postMessage({ command: 'navigateTo', payload: { componentId: nodeId } });
    }
  }
}

function onDragStart(e) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const nodeEl = e.target.closest('.node');
  if (!nodeEl) return;
  const id = nodeEl.id.replace('node-', '');
  draggingNode = nodes.find((n) => n.id === id);

  if (draggingNode) {
    dragHappened = false;

    if (!e.shiftKey) {
      if (!selectedNodes.has(id)) {
        clearSelection();
        selectedNodes.add(id);
        nodeEl.classList.add('selected');
      }
    }

    initialDragPositions.clear();
    selectedNodes.forEach((sid) => {
      const node = nodes.find((n) => n.id === sid);
      if (node) {
        initialDragPositions.set(sid, { x: node.x, y: node.y });
      }
    });

    const primaryNodeInitialPos = initialDragPositions.get(id);
    dragOffsetX = (e.clientX - panX) / scale - primaryNodeInitialPos.x;
    dragOffsetY = (e.clientY - panY) / scale - primaryNodeInitialPos.y;

    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', onDragEnd);
  }
}

function onDrag(e) {
  if (!draggingNode) return;
  dragHappened = true;
  e.preventDefault();

  const mouseX = (e.clientX - panX) / scale;
  const mouseY = (e.clientY - panY) / scale;

  const primaryNodeInitialPos = initialDragPositions.get(draggingNode.id);
  const dx = mouseX - (primaryNodeInitialPos.x + dragOffsetX);
  const dy = mouseY - (primaryNodeInitialPos.y + dragOffsetY);

  selectedNodes.forEach((sid) => {
    const node = nodes.find((n) => n.id === sid);
    const initialPos = initialDragPositions.get(sid);
    if (node && initialPos) {
      node.x = initialPos.x + dx;
      node.y = initialPos.y + dy;
    }
  });

  requestAnimationFrame(drawEdges);
}

function onDragEnd() {
  if (!draggingNode) return;
  if (dragHappened) {
    const layoutPayload = {};
    selectedNodes.forEach((sid) => {
      const node = nodes.find((n) => n.id === sid);
      if (node) {
        layoutPayload[sid] = { x: node.x, y: node.y };
      }
    });
    vscode.postMessage({ command: 'saveLayout', payload: layoutPayload });
  }

  draggingNode = null;
  initialDragPositions.clear();
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', onDragEnd);

  setTimeout(() => {
    dragHappened = false;
  }, 0);
}

function zoom(direction, centerX, centerY) {
  const zoomIntensity = 0.1;
  const oldScale = scale;
  scale = Math.max(0.1, Math.min(4, scale + direction * zoomIntensity * scale));
  panX = centerX - (centerX - panX) * (scale / oldScale);
  panY = centerY - (centerY - panY) * (scale / oldScale);
  updateTransform();
  saveViewState();
}

function resetZoom() {
  scale = 1;
  panX = 0;
  panY = 0;
  updateTransform();
  saveViewState();
}

function setupEventListeners() {
  diagramRoot.addEventListener('wheel', (e) => {
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    const rect = diagramRoot.getBoundingClientRect();
    zoom(direction, e.clientX - rect.left, e.clientY - rect.top);
  });

  diagramRoot.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node')) return;

    if (e.shiftKey) {
      isMarqueeSelecting = true;
      document.body.style.cursor = 'crosshair';
      marqueeStartX = (e.clientX - panX) / scale;
      marqueeStartY = (e.clientY - panY) / scale;
      marquee.style.left = `${marqueeStartX}px`;
      marquee.style.top = `${marqueeStartY}px`;
      marquee.style.width = '0px';
      marquee.style.height = '0px';
      marquee.classList.remove('hidden');

      clearSelection();
    } else if (e.button === 0) {
      isPanning = true;
      lastPanPosition = { x: e.clientX, y: e.clientY };
      document.body.classList.add('panning');
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isPanning) {
      const dx = e.clientX - lastPanPosition.x;
      const dy = e.clientY - lastPanPosition.y;
      panX += dx;
      panY += dy;
      lastPanPosition = { x: e.clientX, y: e.clientY };
      updateTransform();
    } else if (isMarqueeSelecting) {
      const currentX = (e.clientX - panX) / scale;
      const currentY = (e.clientY - panY) / scale;
      const left = Math.min(marqueeStartX, currentX);
      const top = Math.min(marqueeStartY, currentY);
      const width = Math.abs(currentX - marqueeStartX);
      const height = Math.abs(currentY - marqueeStartY);

      marquee.style.left = `${left}px`;
      marquee.style.top = `${top}px`;
      marquee.style.width = `${width}px`;
      marquee.style.height = `${height}px`;

      const marqueeRect = { left, top, right: left + width, bottom: top + height };

      nodes.forEach((node) => {
        const nodeEl = node.element;
        const nodeRect = {
          left: node.x,
          top: node.y,
          right: node.x + nodeEl.offsetWidth,
          bottom: node.y + nodeEl.offsetHeight,
        };

        const intersects = nodeRect.left < marqueeRect.right && nodeRect.right > marqueeRect.left && nodeRect.top < marqueeRect.bottom && nodeRect.bottom > marqueeRect.top;

        if (intersects) {
          if (!selectedNodes.has(node.id)) {
            selectedNodes.add(node.id);
            nodeEl.classList.add('selected');
          }
        } else {
          if (selectedNodes.has(node.id)) {
            selectedNodes.delete(node.id);
            nodeEl.classList.remove('selected');
          }
        }
      });
    } else {
      // Tooltip logic
      const worldX = (e.clientX - panX) / scale;
      const worldY = (e.clientY - panY) / scale;
      let hoveredEdge = null;
      for (const hitbox of edgeLabelHitboxes) {
        if (worldX >= hitbox.x && worldX <= hitbox.x + hitbox.width && worldY >= hitbox.y && worldY <= hitbox.y + hitbox.height) {
          hoveredEdge = hitbox.edge;
          break;
        }
      }
      if (hoveredEdge && hoveredEdge.details && hoveredEdge.details.length > 0) {
        tooltip.innerHTML = '<ul>' + hoveredEdge.details.map((d) => '<li>' + d + '</li>').join('') + '</ul>';
        tooltip.style.left = e.clientX + 15 + 'px';
        tooltip.style.top = e.clientY + 15 + 'px';
        tooltip.classList.remove('hidden');
      } else {
        tooltip.classList.add('hidden');
      }
    }
  });

  diagramRoot.addEventListener('click', (e) => {
    if (!e.target.closest('.node') && !e.shiftKey && !dragHappened) {
      clearSelection();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearSelection();
    } else if (e.key === '+' || e.key === '=') {
      zoom(1, diagramRoot.clientWidth / 2, diagramRoot.clientHeight / 2);
    } else if (e.key === '-') {
      zoom(-1, diagramRoot.clientWidth / 2, diagramRoot.clientHeight / 2);
    } else if (e.key === '0') {
      resetZoom();
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isPanning) {
      isPanning = false;
      document.body.classList.remove('panning');
      saveViewState();
    } else if (isMarqueeSelecting) {
      isMarqueeSelecting = false;
      document.body.style.cursor = 'grab';
      marquee.classList.add('hidden');
    }
  });

  window.addEventListener('mouseleave', () => {
    if (draggingNode) onDragEnd();
    if (isPanning) {
      isPanning = false;
      document.body.classList.remove('panning');
    }
    if (isMarqueeSelecting) {
      isMarqueeSelecting = false;
      document.body.style.cursor = 'grab';
      marquee.classList.add('hidden');
    }
  });

  window.addEventListener('resize', drawEdges);
}

// Export the initialization function
window.initializeDiagram = initializeDiagram;
