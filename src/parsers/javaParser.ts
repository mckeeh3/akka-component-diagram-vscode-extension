import * as vscode from 'vscode';
import * as javaParser from 'java-parser';

// Type definitions for java-parser
interface JavaCST {
  [key: string]: any;
}

interface ParseResult {
  success: boolean;
  cst?: JavaCST;
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
      const cst = javaParser.parse(sourceCode);

      console.log(`[JavaParser] Parse successful for: ${filename}`);
      console.log(`[JavaParser] CST keys: ${Object.keys(cst).join(', ')}`);

      return {
        success: true,
        cst: cst as JavaCST,
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
            if (stringValue) {
              return stringValue;
            }
            // If we can't extract a string value, return a truncated representation
            const jsonStr = JSON.stringify(ev);
            return jsonStr.length > 200 ? jsonStr.substring(0, 200) + '...' : jsonStr;
          });
        } else if (n.children && n.children.elementValuePairList) {
          // Named arguments (e.g., @Anno(key="value"))
          args = n.children.elementValuePairList.map((pair: any) => {
            if (pair.image) return pair.image;
            if (pair.escapedValue) return pair.escapedValue;
            const jsonStr = JSON.stringify(pair);
            return jsonStr.length > 200 ? jsonStr.substring(0, 200) + '...' : jsonStr;
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

    function extractStringValueFromElementValue(ev: any): string {
      if (!ev) return '';
      // Handle conditionalExpression -> binaryExpression -> unaryExpression -> primary -> primaryPrefix -> literal
      if (ev.children && ev.children.conditionalExpression && ev.children.conditionalExpression[0]) {
        const cond = ev.children.conditionalExpression[0];
        if (cond.children && cond.children.binaryExpression && cond.children.binaryExpression[0]) {
          const binary = cond.children.binaryExpression[0];
          if (binary.children && binary.children.unaryExpression && binary.children.unaryExpression[0]) {
            const unary = binary.children.unaryExpression[0];
            if (unary.children && unary.children.primary && unary.children.primary[0]) {
              const primary = unary.children.primary[0];
              if (primary.children && primary.children.primaryPrefix && primary.children.primaryPrefix[0]) {
                const primaryPrefix = primary.children.primaryPrefix[0];
                if (primaryPrefix.children && primaryPrefix.children.literal && primaryPrefix.children.literal[0]) {
                  const literal = primaryPrefix.children.literal[0];
                  if (literal.children && literal.children.StringLiteral && literal.children.StringLiteral[0]) {
                    const stringLiteral = literal.children.StringLiteral[0];
                    return stringLiteral.image ? stringLiteral.image.replace(/^"|"$/g, '') : '';
                  }
                }
              }
              // Fallback: Look for literal inside primary
              if (primary.children && primary.children.literal && primary.children.literal[0]) {
                const literal = primary.children.literal[0];
                if (literal.children && literal.children.StringLiteral && literal.children.StringLiteral[0]) {
                  const stringLiteral = literal.children.StringLiteral[0];
                  return stringLiteral.image ? stringLiteral.image.replace(/^"|"$/g, '') : '';
                }
              }
            }
            // Fallback: Look for literal inside unaryExpression
            if (unary.children && unary.children.literal && unary.children.literal[0]) {
              const literal = unary.children.literal[0];
              if (literal.children && literal.children.StringLiteral && literal.children.StringLiteral[0]) {
                const stringLiteral = literal.children.StringLiteral[0];
                return stringLiteral.image ? stringLiteral.image.replace(/^"|"$/g, '') : '';
              }
            }
          }
          // Fallback: Look for literal directly inside binaryExpression
          if (binary.children && binary.children.literal && binary.children.literal[0]) {
            const literal = binary.children.literal[0];
            if (literal.children && literal.children.StringLiteral && literal.children.StringLiteral[0]) {
              const stringLiteral = literal.children.StringLiteral[0];
              return stringLiteral.image ? stringLiteral.image.replace(/^"|"$/g, '') : '';
            }
          }
        }
      }
      // Handle conditionalExpression (common for annotation arguments)
      if (ev.children && ev.children.conditionalExpression && ev.children.conditionalExpression[0]) {
        const cond = ev.children.conditionalExpression[0];
        if (cond.children && cond.children.literal && cond.children.literal[0]) {
          const literal = cond.children.literal[0];
          if (literal.children && literal.children.StringLiteral && literal.children.StringLiteral[0]) {
            const stringLiteral = literal.children.StringLiteral[0];
            return stringLiteral.image ? stringLiteral.image.replace(/^"|"$/g, '') : '';
          }
        }
      }
      // Fallback to previous logic
      if (ev.children && ev.children.literal && ev.children.literal[0]) {
        const literal = ev.children.literal[0];
        if (literal.children && literal.children.StringLiteral && literal.children.StringLiteral[0]) {
          const stringLiteral = literal.children.StringLiteral[0];
          return stringLiteral.image ? stringLiteral.image.replace(/^"|"$/g, '') : '';
        }
      }
      return '';
    }

    function recurse(n: any) {
      if (n && n.name === 'classDeclaration') {
        let className = '';
        let superclassName = '';
        let hasComponentId = false;
        let componentIdValue = '';
        let endpointType = '';
        let endpointValue = '';

        // Extract class name
        if (n.children && n.children.normalClassDeclaration && n.children.normalClassDeclaration[0]) {
          const normalClass = n.children.normalClassDeclaration[0];
          if (normalClass.children && normalClass.children.typeIdentifier && normalClass.children.typeIdentifier[0]) {
            const typeIdentifier = normalClass.children.typeIdentifier[0];
            if (typeIdentifier.children && typeIdentifier.children.Identifier && typeIdentifier.children.Identifier[0]) {
              className = typeIdentifier.children.Identifier[0].image || '';
            }
          }
          // Extract superclass from classExtends
          if (normalClass.children && normalClass.children.classExtends && normalClass.children.classExtends[0]) {
            const classExtends = normalClass.children.classExtends[0];
            if (classExtends.children && classExtends.children.classType && classExtends.children.classType[0]) {
              const classType = classExtends.children.classType[0];
              if (classType.children && classType.children.Identifier && classType.children.Identifier[0]) {
                superclassName = classType.children.Identifier[0].image || '';
              } else if (classType.children && classType.children.classOrInterfaceType && classType.children.classOrInterfaceType[0]) {
                const nested = classType.children.classOrInterfaceType[0];
                if (nested.children && nested.children.Identifier && nested.children.Identifier[0]) {
                  superclassName = nested.children.Identifier[0].image || '';
                }
              }
            }
          }
        }

        // Check for annotations on the class
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
                  if (annotation.children && annotation.children.elementValue) {
                    const ev = annotation.children.elementValue[0];
                    const stringValue = extractStringValueFromElementValue(ev);
                    componentIdValue = stringValue || '';
                  }
                } else if (endpointAnnotations.includes(annotationName)) {
                  endpointType = annotationName;
                  if (annotation.children && annotation.children.elementValue) {
                    const ev = annotation.children.elementValue[0];
                    const stringValue = extractStringValueFromElementValue(ev);
                    endpointValue = stringValue || '';
                  } else if (annotation.children && annotation.children.elementValuePairList) {
                    const pairs = annotation.children.elementValuePairList;
                    const namePair = pairs.find((pair: any) => pair.children && pair.children.Identifier && pair.children.Identifier[0] && pair.children.Identifier[0].image === 'name');
                    if (namePair && namePair.children && namePair.children.elementValue) {
                      const ev = namePair.children.elementValue[0];
                      const stringValue = extractStringValueFromElementValue(ev);
                      endpointValue = stringValue || '';
                    }
                  }
                  if (!endpointValue) {
                    endpointValue = annotationName.toLowerCase();
                  }
                }
              }
            }
          }
        }

        // Add superclass-based component if it has ComponentId and extends Akka superclass
        if (hasComponentId && componentIdValue && akkaSuperclasses.includes(superclassName)) {
          components.push({
            filename,
            className,
            componentType: superclassName,
            componentId: componentIdValue,
          });
        }
        // Add endpoint-based component if it has endpoint annotation
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
      if (n.children) {
        for (const childKey in n.children) {
          const children = n.children[childKey];
          if (Array.isArray(children)) {
            for (const child of children) {
              recurse(child);
            }
          } else if (children) {
            recurse(children);
          }
        }
      }
    }

    recurse(node);
    return components;
  }
}
