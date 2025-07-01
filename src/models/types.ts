import * as vscode from 'vscode';

export interface AkkaComponent {
  id: string; // The class name, used as a unique ID
  name: string; // The component name from the annotation (e.g., "customer")
  type: string; // e.g., "EventSourcedEntity", "HttpEndpoint"
  uri: vscode.Uri; // The URI of the file where the component is defined
  x?: number; // Optional X coordinate for layout
  y?: number; // Optional Y coordinate for layout
}

export interface AkkaEdge {
  source: string;
  target: string;
  label: string;
  details: string[]; // To hold detailed interaction info, e.g., method names
}

// Data passed from the extension to the webview
export interface SerializableDiagramData {
  nodes: Omit<AkkaComponent, 'uri'>[];
  edges: AkkaEdge[];
}

export interface ViewState {
  panX: number;
  panY: number;
  scale: number;
}