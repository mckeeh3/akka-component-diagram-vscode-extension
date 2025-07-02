import * as vscode from 'vscode';
import * as javaParser from 'java-parser';

// Type definitions for java-parser
interface JavaAST {
  [key: string]: any;
}

interface ParseResult {
  success: boolean;
  ast?: JavaAST;
  error?: string;
  filename: string;
}

export class JavaParser {
  /**
   * Parse a single Java source file
   */
  static async parseFile(fileUri: vscode.Uri): Promise<ParseResult> {
    const filename = fileUri.fsPath;
    console.log(`[JavaParser] Starting to parse file: ${filename}`);

    try {
      // Read the file content
      const document = await vscode.workspace.openTextDocument(fileUri);
      const sourceCode = document.getText();

      console.log(`[JavaParser] File content length: ${sourceCode.length} characters`);

      // Parse the Java source code
      const ast = javaParser.parse(sourceCode);

      console.log(`[JavaParser] Parse successful for: ${filename}`);
      console.log(`[JavaParser] AST keys: ${Object.keys(ast).join(', ')}`);

      return {
        success: true,
        ast: ast as JavaAST,
        filename,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[JavaParser] Parse failed for ${filename}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        filename,
      };
    }
  }

  /**
   * Parse multiple Java source files
   */
  static async parseFiles(files: vscode.Uri[]): Promise<ParseResult[]> {
    console.log(`[JavaParser] Starting to parse ${files.length} Java files`);

    const results: ParseResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const file of files) {
      console.log(`[JavaParser] Processing file ${results.length + 1}/${files.length}: ${file.fsPath}`);

      const result = await this.parseFile(file);
      results.push(result);

      if (result.success) {
        successCount++;
        console.log(`[JavaParser] ✓ Success: ${result.filename}`);
      } else {
        failureCount++;
        console.error(`[JavaParser] ✗ Failed: ${result.filename} - ${result.error}`);
      }
    }

    console.log(`[JavaParser] Parsing complete. Success: ${successCount}, Failures: ${failureCount}`);

    return results;
  }

  /**
   * Log detailed AST information for debugging
   */
  static debugAST(ast: JavaAST, depth: number = 0): void {
    const indent = '  '.repeat(depth);
    const maxDepth = 3; // Limit depth to avoid console spam

    if (depth > maxDepth) {
      console.debug(`${indent}... (max depth reached)`);
      return;
    }

    // Check if this is a node with a name property (common in java-parser)
    const nodeName = ast.name?.escapedValue || ast.name?.image || 'unnamed';
    console.debug(`${indent}Node: ${nodeName}`);

    // Log important properties based on node structure
    if (ast.packageDeclaration) {
      console.debug(`${indent}Package: ${ast.packageDeclaration.name?.escapedValue || 'default'}`);
    }

    if (ast.imports) {
      console.debug(`${indent}Imports: ${ast.imports.length || 0}`);
    }

    if (ast.types) {
      console.debug(`${indent}Types: ${ast.types.length || 0}`);
    }

    if (ast.modifiers) {
      const modifiers = Array.isArray(ast.modifiers) ? ast.modifiers.map((m: any) => m.keyword || m.image).join(', ') : ast.modifiers.keyword || ast.modifiers.image;
      console.debug(`${indent}Modifiers: ${modifiers || 'none'}`);
    }

    if (ast.parameters) {
      console.debug(`${indent}Parameters: ${ast.parameters.length || 0}`);
    }

    if (ast.arguments) {
      console.debug(`${indent}Arguments: ${ast.arguments.length || 0}`);
    }

    // Recursively debug child nodes (limited depth)
    if (depth < maxDepth) {
      for (const [key, value] of Object.entries(ast)) {
        if (key !== 'name' && value && typeof value === 'object') {
          if (Array.isArray(value)) {
            console.debug(`${indent}${key}: [${value.length} items]`);
            value.forEach((item, index) => {
              if (item && typeof item === 'object') {
                console.debug(`${indent}  [${index}]`);
                this.debugAST(item, depth + 2);
              }
            });
          } else if (typeof value === 'object') {
            console.debug(`${indent}${key}:`);
            this.debugAST(value, depth + 1);
          }
        }
      }
    }
  }

  /**
   * Extract all annotation info (name, arguments, location) from a CST node.
   * Returns an array of { name, arguments, location } objects.
   */
  static extractAnnotationsFromCST(node: any): Array<{
    name: string;
    arguments?: string[];
    location?: any;
  }> {
    const results: Array<{ name: string; arguments?: string[]; location?: any }> = [];

    function recurse(n: any) {
      if (n && n.name === 'annotation') {
        // Extract annotation name
        let name = '';
        if (n.children && n.children.typeName && n.children.typeName[0]) {
          const typeNameNode = n.children.typeName[0];
          // Try to get Identifier from typeNameNode
          if (typeNameNode.children && typeNameNode.children.Identifier && typeNameNode.children.Identifier[0]) {
            name = typeNameNode.children.Identifier[0].image || '';
          } else {
            name = typeNameNode.image || typeNameNode.escapedValue || '';
          }
        }

        // Extract arguments (as strings, if present)
        let args: string[] = [];
        if (n.children && n.children.elementValue) {
          // Single argument (e.g., @Anno("foo"))
          args = n.children.elementValue.map((ev: any) => {
            // Try to extract the actual string value from the complex JSON structure
            const stringValue = JavaParser.extractStringValueFromElementValue(ev);
            return stringValue || JSON.stringify(ev);
          });
        } else if (n.children && n.children.elementValuePairList) {
          // Named arguments (e.g., @Anno(key="value"))
          args = n.children.elementValuePairList.map((pair: any) => {
            if (pair.image) return pair.image;
            if (pair.escapedValue) return pair.escapedValue;
            return JSON.stringify(pair);
          });
        }

        results.push({
          name,
          arguments: args.length > 0 ? args : undefined,
          location: n.location,
        });
      }
      // Recurse into children
      if (n && n.children) {
        for (const value of Object.values(n.children)) {
          if (Array.isArray(value)) {
            value.forEach((child) => {
              if (child && typeof child === 'object') {
                recurse(child);
              }
            });
          } else if (value && typeof value === 'object') {
            recurse(value);
          }
        }
      }
    }

    recurse(node);
    return results;
  }

  /**
   * Helper function to extract string values from complex elementValue structures
   * This handles the nested JSON structure that contains StringLiteral nodes
   */
  private static extractStringValueFromElementValue(elementValue: any): string | null {
    try {
      // Navigate through the nested structure to find StringLiteral
      if (elementValue.children && elementValue.children.conditionalExpression) {
        const conditionalExpr = elementValue.children.conditionalExpression[0];
        if (conditionalExpr.children && conditionalExpr.children.binaryExpression) {
          const binaryExpr = conditionalExpr.children.binaryExpression[0];
          if (binaryExpr.children && binaryExpr.children.unaryExpression) {
            const unaryExpr = binaryExpr.children.unaryExpression[0];
            if (unaryExpr.children && unaryExpr.children.primary) {
              const primary = unaryExpr.children.primary[0];
              if (primary.children && primary.children.primaryPrefix) {
                const primaryPrefix = primary.children.primaryPrefix[0];
                if (primaryPrefix.children && primaryPrefix.children.literal) {
                  const literal = primaryPrefix.children.literal[0];
                  if (literal.children && literal.children.StringLiteral) {
                    const stringLiteral = literal.children.StringLiteral[0];
                    if (stringLiteral.image) {
                      // Remove the surrounding quotes from the string literal
                      return stringLiteral.image.replace(/^"|"$/g, '');
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.debug('[JavaParser] Error extracting string value:', error);
    }
    return null;
  }

  /**
   * Extract Akka component information from a CST node.
   * Returns an array of { filename, className, componentType, componentId } objects.
   */
  static extractAkkaComponentsFromCST(
    node: any,
    filename: string
  ): Array<{
    filename: string;
    className: string;
    componentType: string;
    componentId: string;
  }> {
    const components: Array<{
      filename: string;
      className: string;
      componentType: string;
      componentId: string;
    }> = [];
    const akkaSuperclasses = ['Agent', 'EventSourcedEntity', 'KeyValueEntity', 'View', 'Consumer', 'Workflow', 'TimedAction'];
    const endpointAnnotations = ['HttpEndpoint', 'GrpcEndpoint', 'MCPEndpoint'];

    function recurse(n: any) {
      if (n && n.name === 'classDeclaration') {
        let className = '';
        let superclassName = '';

        if (n.children && n.children.normalClassDeclaration && n.children.normalClassDeclaration[0]) {
          const classDecl = n.children.normalClassDeclaration[0];

          // Extract class name from typeIdentifier.children.Identifier[0].image
          if (classDecl.children && classDecl.children.typeIdentifier && classDecl.children.typeIdentifier[0]) {
            const typeIdentifier = classDecl.children.typeIdentifier[0];
            if (typeIdentifier.children && typeIdentifier.children.Identifier && typeIdentifier.children.Identifier[0]) {
              className = typeIdentifier.children.Identifier[0].image || '';
            }
          }

          // Extract superclass from classExtends.children.classType[0].children.Identifier[0].image
          if (classDecl.children && classDecl.children.classExtends && classDecl.children.classExtends[0]) {
            const classExtends = classDecl.children.classExtends[0];
            if (classExtends.children && classExtends.children.classType && classExtends.children.classType[0]) {
              const classType = classExtends.children.classType[0];
              if (classType.children && classType.children.Identifier && classType.children.Identifier[0]) {
                superclassName = classType.children.Identifier[0].image || '';
              }
            }
          }
        }

        // Check for annotations on the class
        let hasComponentId = false;
        let componentIdValue = '';
        let endpointType = '';
        let endpointValue = '';

        if (n.children && n.children.classModifier) {
          for (const modifier of n.children.classModifier) {
            if (modifier.children && modifier.children.annotation) {
              for (const annotation of modifier.children.annotation) {
                // Extract annotation name
                let annotationName = '';
                if (annotation.children && annotation.children.typeName && annotation.children.typeName[0]) {
                  const typeNameNode = annotation.children.typeName[0];
                  if (typeNameNode.children && typeNameNode.children.Identifier && typeNameNode.children.Identifier[0]) {
                    annotationName = typeNameNode.children.Identifier[0].image || '';
                  }
                }

                if (annotationName === 'ComponentId') {
                  hasComponentId = true;
                  // Extract ComponentId value
                  if (annotation.children && annotation.children.elementValue) {
                    const ev = annotation.children.elementValue[0];
                    const stringValue = JavaParser.extractStringValueFromElementValue(ev);
                    componentIdValue = stringValue || '';
                  }
                } else if (endpointAnnotations.includes(annotationName)) {
                  endpointType = annotationName;
                  // Extract endpoint value - handle different argument formats
                  if (annotation.children && annotation.children.elementValue) {
                    // Single argument (e.g., @HttpEndpoint("/path"))
                    const ev = annotation.children.elementValue[0];
                    const stringValue = JavaParser.extractStringValueFromElementValue(ev);
                    endpointValue = stringValue || '';
                  } else if (annotation.children && annotation.children.elementValuePairList) {
                    // Named arguments (e.g., @MCPEndpoint(name="service", port=8080))
                    const pairs = annotation.children.elementValuePairList;
                    const namePair = pairs.find((pair: any) => pair.children && pair.children.Identifier && pair.children.Identifier[0] && pair.children.Identifier[0].image === 'name');
                    if (namePair && namePair.children && namePair.children.elementValue) {
                      const ev = namePair.children.elementValue[0];
                      const stringValue = JavaParser.extractStringValueFromElementValue(ev);
                      endpointValue = stringValue || '';
                    }
                  }
                  // If no arguments found, use the annotation name as the ID
                  if (!endpointValue) {
                    endpointValue = annotationName.toLowerCase();
                  }
                }
              }
            }
          }
        }

        // Check if it's an Akka component based on superclass + ComponentId
        if (hasComponentId && akkaSuperclasses.includes(superclassName)) {
          const componentType = superclassName;
          components.push({
            filename,
            className,
            componentType,
            componentId: componentIdValue,
          });
        }

        // Check if it's an endpoint component (annotation-based)
        if (endpointType && endpointValue) {
          components.push({
            filename,
            className,
            componentType: endpointType,
            componentId: endpointValue,
          });
        }
      }

      // Recurse into children
      if (n && n.children) {
        for (const value of Object.values(n.children)) {
          if (Array.isArray(value)) {
            value.forEach((child) => {
              if (child && typeof child === 'object') {
                recurse(child);
              }
            });
          } else if (value && typeof value === 'object') {
            recurse(value);
          }
        }
      }
    }

    recurse(node);
    return components;
  }
}
