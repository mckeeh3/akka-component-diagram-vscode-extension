import * as vscode from 'vscode';
import { JavaParser } from './javaParser';
import { detectFunctionToolClasses } from './javaCstUtils';
import { createPrefixedLogger } from '../utils/logger';
import { AkkaComponent, AkkaEdge } from '../models/types';

export interface ProcessingResult {
  nodes: AkkaComponent[];
  edges: AkkaEdge[];
  topicNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }>;
  serviceStreamNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }>;
  toolNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }>;
}

export interface ParsedFile {
  filename: string;
  cst: any;
  sourceText: string;
}

export class ComponentDiagramController {
  private log: (message: string) => void;

  constructor(outputChannel?: vscode.OutputChannel) {
    this.log = createPrefixedLogger(outputChannel, '[Controller]');
  }

  /**
   * Main processing flow for creating component diagrams
   */
  async processProject(javaFiles: vscode.Uri[]): Promise<ProcessingResult> {
    this.log('========================================');
    this.log('STARTING COMPONENT DIAGRAM PROCESSING');
    this.log('========================================');

    // Step 1: Parse all Java source files and create CSTs
    this.log('\n=== STEP 1: PARSING JAVA FILES ===');
    const parsedFiles = await this.parseJavaFiles(javaFiles);
    this.log(`Parsed ${parsedFiles.length} Java files successfully`);

    // Step 2: Scan CSTs for Akka components (initial diagram nodes)
    this.log('\n=== STEP 2: DETECTING AKKA COMPONENTS ===');
    const akkaComponents = this.detectAkkaComponents(parsedFiles);
    this.log(`Found ${akkaComponents.length} Akka components`);

    // Step 3: Scan CSTs for function tools
    this.log('\n=== STEP 3: DETECTING FUNCTION TOOLS ===');
    const functionToolComponents = this.detectFunctionTools(parsedFiles);
    this.log(`Found ${functionToolComponents.length} function tool components`);

    // Step 4: Combine component lists (full list of diagram nodes)
    this.log('\n=== STEP 4: COMBINING COMPONENT LISTS ===');
    const allComponents = this.combineComponentLists(akkaComponents, functionToolComponents);
    this.log(`Combined list has ${allComponents.length} total components`);

    // Step 5: Edge detection
    this.log('\n=== STEP 5: DETECTING EDGES ===');
    const edgeDetectionResult = this.detectEdges(parsedFiles, allComponents);
    this.log(`Found ${edgeDetectionResult.edges.length} edges`);

    // Step 6: Create final result
    this.log('\n=== STEP 6: CREATING FINAL RESULT ===');
    const result = this.createFinalResult(allComponents, edgeDetectionResult);

    this.log('========================================');
    this.log('COMPONENT DIAGRAM PROCESSING COMPLETE');
    this.log('========================================');
    this.log(`Final result: ${result.nodes.length} nodes, ${result.edges.length} edges`);

    return result;
  }

  /**
   * Step 1: Parse all Java source files and create CSTs
   */
  private async parseJavaFiles(javaFiles: vscode.Uri[]): Promise<ParsedFile[]> {
    this.log(`Parsing ${javaFiles.length} Java files...`);

    const parseResults = await JavaParser.parseFiles(javaFiles);
    const successfulParses = parseResults.filter((r) => r.success);

    if (successfulParses.length === 0) {
      this.log('No files parsed successfully');
      return [];
    }

    // Get source text for each successfully parsed file
    const parsedFiles: ParsedFile[] = [];
    for (const result of successfulParses) {
      try {
        const document = await vscode.workspace.openTextDocument(result.filename);
        const sourceText = document.getText();
        parsedFiles.push({
          filename: result.filename,
          cst: result.cst,
          sourceText: sourceText,
        });
      } catch (error) {
        this.log(`Error reading source text for ${result.filename}: ${error}`);
      }
    }

    this.log(`Successfully parsed ${parsedFiles.length} files with CST and source text`);
    return parsedFiles;
  }

  /**
   * Step 2: Scan CSTs for Akka components (initial diagram nodes)
   */
  private detectAkkaComponents(parsedFiles: ParsedFile[]): Array<{ className: string; componentType: string; filename: string }> {
    this.log('Detecting Akka components from CSTs...');

    const allAkkaComponents: Array<{ className: string; componentType: string; filename: string }> = [];

    for (const file of parsedFiles) {
      const components = JavaParser.extractAkkaComponentsFromCST(file.cst, file.filename);
      allAkkaComponents.push(...components);

      if (components.length > 0) {
        this.log(`File ${file.filename}: Found ${components.length} Akka components`);
        components.forEach((component, index) => {
          this.log(`  Component ${index + 1}: ${component.className} (${component.componentType})`);
        });
      }
    }

    this.log(`Total Akka components found: ${allAkkaComponents.length}`);
    return allAkkaComponents;
  }

  /**
   * Step 3: Scan CSTs for function tools
   */
  private detectFunctionTools(parsedFiles: ParsedFile[]): Array<{ className: string; componentType: string; filename: string }> {
    this.log('Detecting function tools from CSTs...');

    const allFunctionTools: Array<{ className: string; componentType: string; filename: string }> = [];

    for (const file of parsedFiles) {
      const functionTools = detectFunctionToolClasses(file.cst, file.filename, file.sourceText);
      allFunctionTools.push(...functionTools);

      if (functionTools.length > 0) {
        this.log(`File ${file.filename}: Found ${functionTools.length} function tools`);
        functionTools.forEach((tool, index) => {
          this.log(`  Function tool ${index + 1}: ${tool.className} (${tool.componentType})`);
        });
      }
    }

    this.log(`Total function tools found: ${allFunctionTools.length}`);
    return allFunctionTools;
  }

  /**
   * Step 4: Combine component lists (full list of diagram nodes)
   */
  private combineComponentLists(
    akkaComponents: Array<{ className: string; componentType: string; filename: string }>,
    functionToolComponents: Array<{ className: string; componentType: string; filename: string }>
  ): Array<{ className: string; componentType: string; filename: string }> {
    this.log('Combining Akka components and function tools...');

    // Start with Akka components
    const allComponents = [...akkaComponents];

    // Add function tools that aren't already in the list
    functionToolComponents.forEach((toolComponent) => {
      if (!allComponents.find((c) => c.className === toolComponent.className)) {
        allComponents.push(toolComponent);
        this.log(`Added function tool to component list: ${toolComponent.className}`);
      } else {
        this.log(`Function tool already in component list: ${toolComponent.className}`);
      }
    });

    this.log(`Combined list has ${allComponents.length} total components:`);
    allComponents.forEach((comp, index) => {
      this.log(`  Component ${index + 1}: ${comp.className} (${comp.componentType})`);
    });

    return allComponents;
  }

  /**
   * Step 5: Edge detection
   */
  private detectEdges(
    parsedFiles: ParsedFile[],
    allComponents: Array<{ className: string; componentType: string; filename: string }>
  ): {
    edges: AkkaEdge[];
    topicNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }>;
    serviceStreamNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }>;
    toolNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }>;
  } {
    this.log('Detecting edges between components...');

    const allEdges: AkkaEdge[] = [];
    const allTopicNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];
    const allServiceStreamNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];
    const allToolNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];

    // Convert components to the format expected by edge detection
    const allComponentsForReference = allComponents.map((comp) => ({
      className: comp.className,
      componentType: comp.componentType,
    }));

    for (const file of parsedFiles) {
      this.log(`Processing edges for file: ${file.filename}`);

      // Import the edge detection function
      const { extractComponentConnectionsFromCST } = require('./javaCstUtils');

      const { connections, topicNodes, serviceStreamNodes, toolNodes } = extractComponentConnectionsFromCST(
        file.cst,
        file.filename,
        file.sourceText,
        undefined, // outputChannel
        allComponentsForReference
      );

      // Add edges
      connections.forEach((conn: any) => {
        const edge: AkkaEdge = {
          source: conn.source,
          target: conn.target,
          label: conn.label,
          details: conn.details,
        };
        allEdges.push(edge);
        this.log(`  Edge: ${conn.source} -> ${conn.target} (${conn.label})`);
      });

      // Add topic nodes (avoiding duplicates)
      topicNodes.forEach((topic: any) => {
        if (!allTopicNodes.find((t) => t.id === topic.id)) {
          allTopicNodes.push(topic);
        }
      });

      // Add service stream nodes (avoiding duplicates)
      serviceStreamNodes.forEach((stream: any) => {
        if (!allServiceStreamNodes.find((s) => s.id === stream.id)) {
          allServiceStreamNodes.push(stream);
        }
      });

      // Add tool nodes (avoiding duplicates)
      toolNodes.forEach((tool: any) => {
        if (!allToolNodes.find((t) => t.id === tool.id)) {
          allToolNodes.push(tool);
        }
      });
    }

    this.log(`Total edges found: ${allEdges.length}`);
    this.log(`Total topic nodes found: ${allTopicNodes.length}`);
    this.log(`Total service stream nodes found: ${allServiceStreamNodes.length}`);
    this.log(`Total tool nodes found: ${allToolNodes.length}`);

    return {
      edges: allEdges,
      topicNodes: allTopicNodes,
      serviceStreamNodes: allServiceStreamNodes,
      toolNodes: allToolNodes,
    };
  }

  /**
   * Step 6: Create final result
   */
  private createFinalResult(
    allComponents: Array<{ className: string; componentType: string; filename: string }>,
    edgeDetectionResult: {
      edges: AkkaEdge[];
      topicNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }>;
      serviceStreamNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }>;
      toolNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }>;
    }
  ): ProcessingResult {
    this.log('Creating final processing result...');

    // Convert components to AkkaComponent format
    const componentNodes: AkkaComponent[] = allComponents.map((component) => ({
      id: component.className,
      name: component.className,
      type: component.componentType,
      uri: vscode.Uri.file(component.filename),
    }));

    // Convert topic nodes to AkkaComponent format
    const topicComponents: AkkaComponent[] = edgeDetectionResult.topicNodes.map((topic) => ({
      id: topic.id,
      name: topic.name,
      type: topic.type,
      uri: topic.uri,
    }));

    // Convert service stream nodes to AkkaComponent format
    const serviceStreamComponents: AkkaComponent[] = edgeDetectionResult.serviceStreamNodes.map((stream) => ({
      id: stream.id,
      name: stream.name,
      type: stream.type,
      uri: stream.uri,
    }));

    // Convert tool nodes to AkkaComponent format
    const toolComponents: AkkaComponent[] = edgeDetectionResult.toolNodes.map((tool) => ({
      id: tool.id,
      name: tool.name,
      type: tool.type,
      uri: tool.uri,
    }));

    // Combine all nodes
    const allNodes = [...componentNodes, ...topicComponents, ...serviceStreamComponents, ...toolComponents];

    this.log(`Final result: ${allNodes.length} nodes, ${edgeDetectionResult.edges.length} edges`);

    return {
      nodes: allNodes,
      edges: edgeDetectionResult.edges,
      topicNodes: edgeDetectionResult.topicNodes,
      serviceStreamNodes: edgeDetectionResult.serviceStreamNodes,
      toolNodes: edgeDetectionResult.toolNodes,
    };
  }
}
