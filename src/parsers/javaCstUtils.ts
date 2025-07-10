import { parse } from 'java-parser';
import { AkkaComponent, AkkaEdge } from '../models/types';
import * as vscode from 'vscode';
import { createPrefixedLogger } from '../utils/logger';

/**
 * Utility function to extract Java source code from a CST node location
 * @param sourceText The complete Java source code
 * @param location The CST node location with startOffset and endOffset
 * @returns The Java source code at the specified location, or empty string if location is invalid
 *
 * @example
 * const sourceText = "public class MyClass { public void method() { } }";
 * const location = { startOffset: 13, endOffset: 20 }; // "MyClass"
 * const extracted = extractSourceAtLocation(sourceText, location);
 * // Returns: "MyClass"
 */
export function extractSourceAtLocation(sourceText: string, location: { startOffset: number; endOffset: number }): string {
  if (!sourceText || !location || typeof location.startOffset !== 'number' || typeof location.endOffset !== 'number') {
    return '';
  }

  if (location.startOffset < 0 || location.endOffset > sourceText.length || location.startOffset > location.endOffset) {
    return '';
  }

  return sourceText.substring(location.startOffset, location.endOffset + 1);
}

/**
 * Extracts Akka component connections from a Java CST.
 * Looks for injected ComponentClient variable name and uses it to find for*().method().invoke() chains.
 * Also looks for @Consume.From... annotations.
 * @param cst The CST root
 * @param filename The filename (for debugging)
 * @param sourceText The source text (for extracting method parameters)
 * @param outputChannel Optional VS Code output channel for logging
 * @returns Array of connections: { sourceClass, targetType, targetClass, methodName, location }
 */
export function extractComponentConnectionsFromCST(
  cst: any,
  filename: string,
  sourceText?: string,
  outputChannel?: vscode.OutputChannel,
  allComponents?: Array<{ className: string; componentType: string }>
) {
  console.log('[DEBUG] Top of extractComponentConnectionsFromCST');
  const log = outputChannel ? createPrefixedLogger(outputChannel, '[CSTUtils]') : console.log;

  log('[DEBUG] Top of extractComponentConnectionsFromCST');
  log(`========================================`);
  log(`STARTING CST-BASED EDGE DETECTION FOR: ${filename}`);
  log(`========================================`);
  log(`All components available for reference detection: ${allComponents ? allComponents.length : 0}`);
  if (allComponents && allComponents.length > 0) {
    allComponents.forEach((comp, index) => {
      log(`  Component ${index + 1}: ${comp.className} (${comp.componentType})`);
    });
  }

  const connections: Array<{
    source: string;
    target: string;
    label: string;
    details: string[];
  }> = [];
  const topicNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];
  const serviceStreamNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];
  const toolNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];

  // Helper: get class name
  function getClassName(classDecl: any): string | undefined {
    if (
      classDecl &&
      classDecl.children &&
      classDecl.children.classDeclaration &&
      classDecl.children.classDeclaration[0].children.normalClassDeclaration &&
      classDecl.children.classDeclaration[0].children.normalClassDeclaration[0].children.typeIdentifier &&
      classDecl.children.classDeclaration[0].children.normalClassDeclaration[0].children.typeIdentifier[0].children.Identifier
    ) {
      return classDecl.children.classDeclaration[0].children.normalClassDeclaration[0].children.typeIdentifier[0].children.Identifier[0].image;
    }
    return undefined;
  }

  // Helper: find injected ComponentClient field names in the class
  function findComponentClientFieldNames(classBodyDecls: any[]): string[] {
    const fieldNames: string[] = [];
    log(`Finding ComponentClient field names in class body declarations...`);

    // 1. Find constructor(s)
    for (const bodyDecl of classBodyDecls) {
      if (bodyDecl.children && bodyDecl.children.constructorDeclaration) {
        const ctor = bodyDecl.children.constructorDeclaration[0];
        log(`Found constructor, checking parameters...`);

        // Find parameters
        if (ctor.children.constructorDeclarator && ctor.children.constructorDeclarator[0].children.formalParameterList) {
          const params = ctor.children.constructorDeclarator[0].children.formalParameterList[0];
          if (params.children.formalParameter) {
            log(`Found ${params.children.formalParameter.length} constructor parameters`);

            for (const param of params.children.formalParameter) {
              log(`Checking parameter: ${JSON.stringify(Object.keys(param.children || {}))}`);

              // Look for type ComponentClient - simplified path checking
              let isComponentClient = false;
              let paramName = '';

              // Check if this parameter is of type ComponentClient
              if (param.children && param.children.variableParaRegularParameter) {
                const varParam = param.children.variableParaRegularParameter[0];

                // Get parameter name
                if (varParam.children && varParam.children.variableDeclaratorId && varParam.children.variableDeclaratorId[0].children.Identifier) {
                  paramName = varParam.children.variableDeclaratorId[0].children.Identifier[0].image;
                  log(`Parameter name: ${paramName}`);
                }

                // Check type - simplified path
                if (varParam.children && varParam.children.unannType) {
                  const unannType = varParam.children.unannType[0];

                  // Try multiple paths to find the type name
                  let typeName = '';

                  // Path 1: unannReferenceType -> unannClassOrInterfaceType -> unannClassType -> Identifier
                  if (unannType.children && unannType.children.unannReferenceType) {
                    const refType = unannType.children.unannReferenceType[0];
                    if (refType.children && refType.children.unannClassOrInterfaceType) {
                      const classType = refType.children.unannClassOrInterfaceType[0];
                      if (classType.children && classType.children.unannClassType) {
                        const classTypeNode = classType.children.unannClassType[0];
                        if (classTypeNode.children && classTypeNode.children.Identifier) {
                          typeName = classTypeNode.children.Identifier[0].image;
                        }
                      }
                    }
                  }

                  // Path 2: unannReferenceType -> fqnOrRefType (for fully qualified names)
                  if (!typeName && unannType.children && unannType.children.unannReferenceType) {
                    const refType = unannType.children.unannReferenceType[0];
                    if (refType.children && refType.children.fqnOrRefType) {
                      const fqnType = refType.children.fqnOrRefType[0];
                      // Extract the last part of the FQN
                      if (fqnType.children && fqnType.children.fqnOrRefTypePartFirst) {
                        const partFirst = fqnType.children.fqnOrRefTypePartFirst[0];
                        if (partFirst.children && partFirst.children.fqnOrRefTypePartCommon) {
                          const partCommon = partFirst.children.fqnOrRefTypePartCommon[0];
                          if (partCommon.children && partCommon.children.Identifier) {
                            typeName = partCommon.children.Identifier[0].image;
                          }
                        }
                      }
                    }
                  }

                  log(`Parameter type: ${typeName}`);
                  isComponentClient = typeName.includes('ComponentClient');
                }
              }

              if (isComponentClient && paramName) {
                log(`Found ComponentClient parameter: ${paramName}`);

                // Now, look for assignments in the constructor body: this.FIELD = paramName;
                if (ctor.children.constructorBody && ctor.children.constructorBody[0].children.blockStatements) {
                  log(`Checking constructor body for field assignments...`);

                  for (const blockStmt of ctor.children.constructorBody[0].children.blockStatements) {
                    if (blockStmt.children && blockStmt.children.blockStatement) {
                      for (const stmt of blockStmt.children.blockStatement) {
                        // Look for assignment statements: this.fieldName = paramName;
                        if (stmt.children && stmt.children.statement) {
                          const statement = stmt.children.statement[0];

                          // Extract assignment using source text if available
                          if (statement.location && sourceText) {
                            const stmtText = extractSourceAtLocation(sourceText, statement.location);
                            log(`Statement text: "${stmtText}"`);

                            // Look for pattern: this.fieldName = paramName;
                            const assignmentPattern = new RegExp(`this\\.(\\w+)\\s*=\\s*${paramName}\\s*;?`);
                            const match = stmtText.match(assignmentPattern);

                            if (match) {
                              const fieldName = match[1];
                              fieldNames.push(fieldName);
                              log(`Found ComponentClient field assignment: ${fieldName} = ${paramName}`);
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Fallback: if no field names found, try to find any field that might be a ComponentClient
    if (fieldNames.length === 0) {
      log(`No ComponentClient field names found with constructor detection, trying fallback...`);
      for (const bodyDecl of classBodyDecls) {
        if (bodyDecl.children && bodyDecl.children.fieldDeclaration) {
          const fieldDecl = bodyDecl.children.fieldDeclaration[0];
          if (fieldDecl.children && fieldDecl.children.unannType) {
            const type = fieldDecl.children.unannType[0];
            if (type.children && type.children.unannReferenceType) {
              const refType = type.children.unannReferenceType[0];
              if (refType.children && refType.children.unannClassOrInterfaceType) {
                const classType = refType.children.unannClassOrInterfaceType[0];
                if (classType.children && classType.children.unannClassType) {
                  const classTypeNode = classType.children.unannClassType[0];
                  if (classTypeNode.children && classTypeNode.children.Identifier) {
                    const typeName = classTypeNode.children.Identifier[0].image;
                    if (typeName.includes('ComponentClient')) {
                      // Get the field name
                      if (fieldDecl.children && fieldDecl.children.variableDeclaratorList) {
                        const varList = fieldDecl.children.variableDeclaratorList[0];
                        if (varList.children && varList.children.variableDeclarator) {
                          const varDecl = varList.children.variableDeclarator[0];
                          if (varDecl.children && varDecl.children.variableDeclaratorId) {
                            const varId = varDecl.children.variableDeclaratorId[0];
                            if (varId.children && varId.children.Identifier) {
                              const fieldName = varId.children.Identifier[0].image;
                              fieldNames.push(fieldName);
                              log(`Found ComponentClient field with fallback: ${fieldName}`);
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    if (fieldNames.length > 0) {
      log(`ComponentClient field names found: ${fieldNames.join(', ')}`);
    } else {
      log(`No ComponentClient field names found`);
    }
    return fieldNames;
  }

  // Helper: find function tool invocations in method bodies
  function findFunctionToolInvocations(blockStmt: any, className: string) {
    if (!blockStmt || !blockStmt.children) return;

    function searchForToolInvocations(node: any) {
      if (!node || typeof node !== 'object') return;

      if (node.children) {
        for (const [key, children] of Object.entries(node.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              if (child && typeof child === 'object') {
                // Look for primary nodes that could be the start of a tool invocation chain
                if (key === 'primary') {
                  const primary = child;
                  if (primary.location && sourceText) {
                    const chainText = extractSourceAtLocation(sourceText, primary.location);

                    // Look for .tools() and .mcpTools() invocations
                    const toolsMatch = chainText.match(/\.tools\(([^)]+)\)/);
                    const mcpToolsMatch = chainText.match(/\.mcpTools\(([^)]+)\)/);

                    if (toolsMatch) {
                      const toolArgs = toolsMatch[1].split(',').map((arg) => arg.trim());
                      for (const arg of toolArgs) {
                        // Handle different tool argument patterns
                        let toolName = arg.replace(/\.class$/, '');

                        // Handle List.of() patterns with multiple tool instances
                        if (toolName.includes('List.of(')) {
                          const listMatch = toolName.match(/List\.of\(([^)]+)\)/);
                          if (listMatch) {
                            const listArgs = listMatch[1].split(',').map((listArg) => listArg.trim());
                            log(`[Tool Detection] Found List.of() with ${listArgs.length} arguments: ${listArgs.join(', ')}`);
                            for (const listArg of listArgs) {
                              // Extract tool class name from constructor calls like "new DrawRectangleTool(...)"
                              const constructorMatch = listArg.match(/new\s+(\w+)\s*\(/);
                              if (constructorMatch) {
                                const toolClassName = constructorMatch[1];
                                log(`[Tool Detection] Found tool constructor: ${toolClassName}`);
                                const toolId = `tool:${toolClassName}`;
                                if (!toolNodes.find((t) => t.id === toolId)) {
                                  toolNodes.push({ id: toolId, name: toolClassName, type: 'FunctionTool', uri: vscode.Uri.file(filename) });
                                }
                                connections.push({ source: className, target: toolId, label: 'uses tool', details: [] });
                                log(`[Tool Detection] Found tool in List.of(): ${toolClassName}`);
                              } else {
                                // Handle case where tool is referenced as a class name without constructor
                                const classMatch = listArg.match(/^(\w+)$/);
                                if (classMatch) {
                                  const toolClassName = classMatch[1];
                                  log(`[Tool Detection] Found tool class reference: ${toolClassName}`);
                                  const toolId = `tool:${toolClassName}`;
                                  if (!toolNodes.find((t) => t.id === toolId)) {
                                    toolNodes.push({ id: toolId, name: toolClassName, type: 'FunctionTool', uri: vscode.Uri.file(filename) });
                                  }
                                  connections.push({ source: className, target: toolId, label: 'uses tool', details: [] });
                                  log(`[Tool Detection] Found tool class reference: ${toolClassName}`);
                                }
                              }
                            }
                          }
                        } else {
                          // Handle simple variable references
                          const toolId = `tool:${toolName}`;
                          if (!toolNodes.find((t) => t.id === toolId)) {
                            toolNodes.push({ id: toolId, name: toolName, type: 'FunctionTool', uri: vscode.Uri.file(filename) });
                          }
                          connections.push({ source: className, target: toolId, label: 'uses tool', details: [] });
                          log(`[Tool Detection] Found tool reference: ${toolName}`);
                        }
                      }
                    }

                    if (mcpToolsMatch) {
                      const mcpToolArgs = mcpToolsMatch[1].split(',').map((arg) => arg.trim());
                      for (const arg of mcpToolArgs) {
                        const serviceNameMatch = arg.match(/fromService\("([^"]+)"\)/);
                        if (serviceNameMatch) {
                          const serviceName = serviceNameMatch[1];
                          const toolId = `mcp-tool:${serviceName}`;
                          if (!toolNodes.find((t) => t.id === toolId)) {
                            toolNodes.push({ id: toolId, name: serviceName, type: 'MCPTool', uri: vscode.Uri.file(filename) });
                          }
                          connections.push({ source: className, target: toolId, label: 'uses MCP tool', details: [] });
                        }
                      }
                    }
                  }
                }
                // Recurse deeper
                searchForToolInvocations(child);
              }
            }
          } else if (children && typeof children === 'object') {
            searchForToolInvocations(children);
          }
        }
      }
    }

    searchForToolInvocations(blockStmt);
  }

  // Helper: find componentClient invocation chains in method bodies
  function findComponentClientChains(blockStmt: any, className: string, clientFieldNames: string[]) {
    if (!blockStmt || !blockStmt.children) return;

    // Recursively search for primary nodes that start with a client field and walk their primarySuffix chain
    function searchForClientChains(node: any, path: string = '') {
      if (!node || typeof node !== 'object') return;

      if (node.children) {
        for (const [key, children] of Object.entries(node.children)) {
          if (Array.isArray(children)) {
            for (let i = 0; i < children.length; i++) {
              const child = children[i];
              if (child && typeof child === 'object') {
                // Look for primary nodes
                if (key === 'primary') {
                  const primary = child;
                  if (primary.children && primary.children.primaryPrefix) {
                    const prefix = primary.children.primaryPrefix[0];
                    let varName = undefined;
                    if (prefix.children && prefix.children.Identifier) {
                      varName = prefix.children.Identifier[0].image;
                    } else if (prefix.children && prefix.children.fqnOrRefType) {
                      // Check for fqnOrRefType path
                      const fqnRef = prefix.children.fqnOrRefType[0];
                      if (fqnRef.children && fqnRef.children.fqnOrRefTypePartFirst) {
                        const partFirst = fqnRef.children.fqnOrRefTypePartFirst[0];
                        if (partFirst.children && partFirst.children.fqnOrRefTypePartCommon) {
                          const partCommon = partFirst.children.fqnOrRefTypePartCommon[0];
                          if (partCommon.children && partCommon.children.Identifier) {
                            varName = partCommon.children.Identifier[0].image;
                          }
                        }
                      }
                    }
                    if (varName && clientFieldNames.includes(varName)) {
                      log(`Found component client field: ${varName}`);
                      // Walk the primarySuffix chain
                      const suffixes = primary.children.primarySuffix || [];
                      let chain = [];

                      // Extract the first method name from primaryPrefix.fqnOrRefType.fqnOrRefTypePartRest
                      if (prefix.children && prefix.children.fqnOrRefType) {
                        const fqnRef = prefix.children.fqnOrRefType[0];
                        if (fqnRef.children && fqnRef.children.fqnOrRefTypePartRest) {
                          const partRest = fqnRef.children.fqnOrRefTypePartRest[0];
                          if (partRest.children && partRest.children.fqnOrRefTypePartCommon) {
                            const partCommon = partRest.children.fqnOrRefTypePartCommon[0];
                            if (partCommon.children && partCommon.children.Identifier) {
                              const firstMethod = partCommon.children.Identifier[0].image;
                              chain.push(firstMethod);
                              log(`Extracted first method from FQN: ${firstMethod}`);
                            }
                          }
                        }
                      }

                      // If no method was extracted from FQN, try to extract from the first suffix
                      if (chain.length === 0 && suffixes.length > 0) {
                        const firstSuffix = suffixes[0];
                        if (firstSuffix.children && firstSuffix.children.Identifier) {
                          const firstMethod = firstSuffix.children.Identifier[0].image;
                          chain.push(firstMethod);
                          log(`Extracted first method from first suffix: ${firstMethod}`);
                        }
                      }

                      // Extract subsequent method names from primarySuffix
                      for (let i = 0; i < suffixes.length; i++) {
                        const suffix = suffixes[i];
                        if (suffix.children && suffix.children.Dot && suffix.children.Identifier) {
                          // Extract method name from Dot.Identifier
                          const methodName = suffix.children.Identifier[0].image;
                          chain.push(methodName);
                          log(`Extracted method from suffix ${i}: ${methodName}`);
                        }
                      }

                      // Look for for* -> [any methods] -> method -> invoke pattern
                      log(`Checking chain: ${chain.join(' -> ')}`);

                      // Find the pattern: starts with for*, contains method, ends with invoke
                      const hasForMethod = chain.some((method) => method.startsWith('for') || method === 'forView' || method === 'forEventSourcedEntity');
                      const hasMethodCall = chain.includes('method');
                      const hasInvokeCall = chain.some((method) => method === 'invoke' || method === 'invokeAsync' || method === 'deferred');

                      if (hasForMethod && hasMethodCall && hasInvokeCall) {
                        log(`Found valid chain pattern: ${chain.join(' -> ')}`);
                        // Extract target component type and method name from the method reference argument
                        let targetComponentType = '';
                        let calledMethodName = '';

                        // Find the method invocation that contains the method parameter
                        // The method parameter is typically in the 'method()' call, not the 'invoke()' call
                        let methodInv = null;
                        let methodSuffixIndex = -1;
                        log(`Looking for method invocation in ${suffixes.length} suffixes...`);

                        // First, find the 'method' suffix that contains the method parameter
                        for (let i = 0; i < suffixes.length; i++) {
                          const suffix = suffixes[i];
                          log(`Checking suffix ${i}: ${JSON.stringify(Object.keys(suffix.children || {}))}`);
                          if (suffix.children && suffix.children.methodInvocationSuffix) {
                            const methodSuffix = suffix.children.methodInvocationSuffix[0];
                            // Check if this is the 'method' call by looking at the previous identifier
                            if (i > 0 && suffixes[i - 1].children && suffixes[i - 1].children.Identifier) {
                              const prevMethod = suffixes[i - 1].children.Identifier[0].image;
                              if (prevMethod === 'method') {
                                methodInv = methodSuffix;
                                methodSuffixIndex = i;
                                log(`Found method invocation in suffix ${i} (method call)`);
                                break;
                              }
                            }
                          }
                        }

                        // If we didn't find the method call, fall back to the last method invocation (invoke)
                        if (!methodInv) {
                          for (let i = 0; i < suffixes.length; i++) {
                            const suffix = suffixes[i];
                            if (suffix.children && suffix.children.methodInvocationSuffix) {
                              methodInv = suffix.children.methodInvocationSuffix[0];
                              methodSuffixIndex = i;
                              log(`Found method invocation in suffix ${i} (fallback)`);
                              break;
                            }
                          }
                        }

                        if (methodInv) {
                          log(`Found method invocation, checking for argument list...`);
                          log(`Method invocation children: ${JSON.stringify(Object.keys(methodInv.children || {}))}`);

                          if (methodInv.children && methodInv.children.argumentList) {
                            const argList = methodInv.children.argumentList[0];
                            log(`Found argument list, checking for expressions...`);
                            log(`Argument list children: ${JSON.stringify(Object.keys(argList.children || {}))}`);

                            if (argList.children && argList.children.expression) {
                              const expr = argList.children.expression[0];
                              log(`Found expression in argument list`);
                              log(`Expression children: ${JSON.stringify(Object.keys(expr.children || {}))}`);

                              // Use the location offsets to extract the method parameter directly from source text
                              if (methodInv.location && methodInv.location.startOffset !== undefined && methodInv.location.endOffset !== undefined) {
                                log(`Method invocation location: ${methodInv.location.startOffset} to ${methodInv.location.endOffset}`);

                                // Extract the method parameter text directly from source
                                if (sourceText) {
                                  const methodParamText = extractSourceAtLocation(sourceText, methodInv.location);
                                  log(`Method parameter text: "${methodParamText}"`);

                                  // Remove parentheses from the extracted text
                                  const cleanParamText = methodParamText.replace(/^\(|\)$/g, '');
                                  log(`Clean parameter text: "${cleanParamText}"`);

                                  // Parse the ClassName::methodName format
                                  const parts = cleanParamText.split('::');
                                  if (parts.length === 2) {
                                    targetComponentType = parts[0];
                                    calledMethodName = parts[1];
                                    log(`Extracted from text - Class: ${targetComponentType}, Method: ${calledMethodName}`);
                                  } else {
                                    log(`Could not parse method parameter: "${cleanParamText}"`);
                                    log(`Parts after split: ${JSON.stringify(parts)}`);
                                  }
                                } else {
                                  log(`No source text provided, cannot extract method name`);
                                }
                              }
                            } else {
                              log(`No expression found in argument list`);
                              // Try to find the method reference in a different way
                              if (argList.children) {
                                log(`Available children in argument list: ${JSON.stringify(Object.keys(argList.children))}`);
                                // Look for methodReference or other possible structures
                                for (const [childKey, childValue] of Object.entries(argList.children)) {
                                  log(`Checking argument list child: ${childKey}`);
                                  if (Array.isArray(childValue) && childValue.length > 0) {
                                    const child = childValue[0];
                                    log(`Child ${childKey} has location: ${child.location ? 'yes' : 'no'}`);
                                    if (child.location && sourceText) {
                                      const childText = extractSourceAtLocation(sourceText, child.location);
                                      log(`Child ${childKey} text: "${childText}"`);

                                      // Parse the ClassName::methodName format
                                      const parts = childText.split('::');
                                      if (parts.length === 2) {
                                        targetComponentType = parts[0];
                                        calledMethodName = parts[1];
                                        log(`Extracted from child ${childKey} - Class: ${targetComponentType}, Method: ${calledMethodName}`);
                                        break;
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        } else {
                          log(`No method invocation found in suffixes`);
                        }

                        // Method name extraction is now done in the same loop where we find the class name

                        if (targetComponentType) {
                          const details = []; // Start with empty details array
                          if (calledMethodName) {
                            details.push(calledMethodName); // Add only the called method name
                          }
                          log(`Found connection: ${className} -> ${targetComponentType} (${calledMethodName})`);
                          log(`Chain: ${chain.join(' -> ')}`);
                          log(`Called method name: ${calledMethodName}`);
                          log(`Details array: ${JSON.stringify(details)}`);
                          connections.push({
                            source: className,
                            target: targetComponentType,
                            label: calledMethodName || chain[0], // Use the actual method name, fallback to chain[0]
                            details: details,
                          });
                        }
                      }
                    }
                  }
                }
                // Recursively search deeper
                searchForClientChains(child, `${path}.${key}[${i}]`);
              }
            }
          } else if (children && typeof children === 'object') {
            searchForClientChains(children, `${path}.${key}`);
          }
        }
      }
    }

    searchForClientChains(blockStmt);
  }

  // Helper: find component-to-component connections by scanning for class name references
  function findComponentReferences(cst: any, allComponents: Array<{ className: string; componentType: string }>, className: string) {
    log(`[DEBUG] Entered findComponentReferences for class: ${className}`);
    if (!cst || !allComponents || allComponents.length === 0) {
      log(`[Component Reference Detection] Skipping - no CST or components available`);
      return;
    }

    // Get all component class names for reference (including tool classes)
    const componentClassNames = allComponents.map((comp) => comp.className);
    log(`[Component Reference Detection] Looking for references to: ${componentClassNames.join(', ')}`);

    let referenceCount = 0;

    function searchForComponentReferences(node: any, depth = 0) {
      if (!node || typeof node !== 'object') return;
      // Check if this node itself has an image that matches a component class name
      if (node.image) {
        // if (className === 'VisualizerAgent') {
        //   log(`[Component Reference Detection] Depth ${depth} Node image: ${node.image}`);
        // }
        const referencedClassName = node.image;
        if (componentClassNames.includes(referencedClassName) && referencedClassName !== className) {
          log(`[Component Reference Detection] Found reference to component: ${referencedClassName} in ${className}`);
          connections.push({
            source: className,
            target: referencedClassName,
            label: 'references',
            details: [],
          });
          referenceCount++;
        }
      }
      if (node.children) {
        for (const [key, children] of Object.entries(node.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              if (child && typeof child === 'object') {
                searchForComponentReferences(child, depth + 1);
              }
            }
          } else if (children && typeof children === 'object') {
            searchForComponentReferences(children, depth + 1);
          }
        }
      }
    }

    searchForComponentReferences(cst);
    log(`[Component Reference Detection] Found ${referenceCount} references from ${className} to other components`);
  }

  // Helper: find tool-related field declarations and their initialization
  function findToolFieldDeclarations(classBodyDecls: any[], className: string) {
    for (const bodyDecl of classBodyDecls) {
      if (bodyDecl.children && bodyDecl.children.classMemberDeclaration) {
        const memberDecl = bodyDecl.children.classMemberDeclaration[0];

        // Check for field declarations
        if (memberDecl.children && memberDecl.children.fieldDeclaration) {
          const fieldDecl = memberDecl.children.fieldDeclaration[0];
          if (fieldDecl.children && fieldDecl.children.variableDeclaratorList) {
            const varDeclList = fieldDecl.children.variableDeclaratorList[0];
            if (varDeclList.children && varDeclList.children.variableDeclarator) {
              for (const varDecl of varDeclList.children.variableDeclarator) {
                if (varDecl.children && varDecl.children.variableDeclaratorId) {
                  const varId = varDecl.children.variableDeclaratorId[0];
                  if (varId.children && varId.children.Identifier) {
                    const fieldName = varId.children.Identifier[0].image;

                    // Check if this looks like a tool collection field
                    if (fieldName.toLowerCase().includes('tool') || fieldName.toLowerCase().includes('function')) {
                      log(`[Tool Detection] Found potential tool field: ${fieldName}`);

                      // Check for initialization
                      if (varDecl.children && varDecl.children.variableInitializer) {
                        const init = varDecl.children.variableInitializer[0];
                        if (init.location && sourceText) {
                          const initText = extractSourceAtLocation(sourceText, init.location);
                          log(`[Tool Detection] Tool field initialization: ${initText}`);

                          // Look for List.of() patterns in initialization
                          const listMatch = initText.match(/List\.of\(([^)]+)\)/);
                          if (listMatch) {
                            const listArgs = listMatch[1].split(',').map((arg) => arg.trim());
                            for (const arg of listArgs) {
                              const constructorMatch = arg.match(/new\s+(\w+)\s*\(/);
                              if (constructorMatch) {
                                const toolClassName = constructorMatch[1];
                                const toolId = `tool:${toolClassName}`;
                                if (!toolNodes.find((t) => t.id === toolId)) {
                                  toolNodes.push({ id: toolId, name: toolClassName, type: 'FunctionTool', uri: vscode.Uri.file(filename) });
                                }
                                connections.push({ source: className, target: toolId, label: 'defines tool', details: [] });
                                log(`[Tool Detection] Found tool in field initialization: ${toolClassName}`);
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Helper: find tool class definitions and their methods
  function findToolClassDefinitions(cst: any) {
    if (!cst.children || !cst.children.ordinaryCompilationUnit) return;

    const compilationUnit = cst.children.ordinaryCompilationUnit[0];
    if (!compilationUnit.children || !compilationUnit.children.typeDeclaration) return;

    for (const typeDecl of compilationUnit.children.typeDeclaration) {
      if (typeDecl.children && typeDecl.children.classDeclaration) {
        const classDecl = typeDecl.children.classDeclaration[0];
        if (classDecl.children && classDecl.children.normalClassDeclaration) {
          const normalClass = classDecl.children.normalClassDeclaration[0];
          const className = getClassName(classDecl);

          if (!className) continue;

          // Check if this class has @FunctionTool methods
          if (normalClass.children && normalClass.children.classBody) {
            const classBody = normalClass.children.classBody[0];
            if (classBody.children && classBody.children.classBodyDeclaration) {
              const classBodyDecls = classBody.children.classBodyDeclaration;

              // Check for @FunctionTool methods in this class
              for (const bodyDecl of classBodyDecls) {
                if (bodyDecl.children && bodyDecl.children.classMemberDeclaration) {
                  const memberDecl = bodyDecl.children.classMemberDeclaration[0];
                  if (memberDecl.children && memberDecl.children.methodDeclaration) {
                    const methodDecl = memberDecl.children.methodDeclaration[0];
                    if (methodDecl.children && methodDecl.children.methodModifier) {
                      for (const modifier of methodDecl.children.methodModifier) {
                        if (modifier.children && modifier.children.annotation) {
                          for (const annotation of modifier.children.annotation) {
                            if (annotation.location && sourceText) {
                              const annotationText = extractSourceAtLocation(sourceText, annotation.location);
                              if (annotationText.startsWith('@FunctionTool')) {
                                const methodName = methodDecl.children.methodHeader[0].children.methodDeclarator[0].children.Identifier[0].image;
                                const toolId = `tool:${className}.${methodName}`;
                                if (!toolNodes.find((t) => t.id === toolId)) {
                                  toolNodes.push({ id: toolId, name: `${className}.${methodName}`, type: 'FunctionTool', uri: vscode.Uri.file(filename) });
                                }
                                log(`[Tool Detection] Found tool class method: ${className}.${methodName}`);
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Helper: find methods annotated with @FunctionTool
  function findFunctionToolAnnotations(classBodyDecls: any[], className: string) {
    for (const bodyDecl of classBodyDecls) {
      if (bodyDecl.children && bodyDecl.children.classMemberDeclaration) {
        const memberDecl = bodyDecl.children.classMemberDeclaration[0];
        if (memberDecl.children && memberDecl.children.methodDeclaration) {
          const methodDecl = memberDecl.children.methodDeclaration[0];
          if (methodDecl.children && methodDecl.children.methodModifier) {
            for (const modifier of methodDecl.children.methodModifier) {
              if (modifier.children && modifier.children.annotation) {
                for (const annotation of modifier.children.annotation) {
                  if (annotation.location && sourceText) {
                    const annotationText = extractSourceAtLocation(sourceText, annotation.location);
                    if (annotationText.startsWith('@FunctionTool')) {
                      const methodName = methodDecl.children.methodHeader[0].children.methodDeclarator[0].children.Identifier[0].image;
                      const toolId = `tool:${className}.${methodName}`;
                      if (!toolNodes.find((t) => t.id === toolId)) {
                        toolNodes.push({ id: toolId, name: methodName, type: 'FunctionTool', uri: vscode.Uri.file(filename) });
                      }
                      connections.push({ source: className, target: toolId, label: 'defines tool', details: [] });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Helper: extract all annotations from CST
  function extractAllAnnotations(cst: any): Array<{ annotation: any; className: string }> {
    const annotations: Array<{ annotation: any; className: string }> = [];

    function findAnnotations(node: any, className: string) {
      if (!node || typeof node !== 'object') return;

      if (node.children) {
        for (const [key, children] of Object.entries(node.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              if (child && typeof child === 'object') {
                // Look for annotation nodes
                if (key === 'annotation') {
                  annotations.push({ annotation: child, className });
                }
                // Recursively search deeper
                findAnnotations(child, className);
              }
            }
          } else if (children && typeof children === 'object') {
            findAnnotations(children, className);
          }
        }
      }
    }

    // Find annotations in all classes
    if (cst.children && cst.children.ordinaryCompilationUnit && cst.children.ordinaryCompilationUnit[0].children.typeDeclaration) {
      cst.children.ordinaryCompilationUnit[0].children.typeDeclaration.forEach((typeDecl: any) => {
        if (typeDecl.children && typeDecl.children.classDeclaration && typeDecl.children.classDeclaration[0].children.normalClassDeclaration) {
          const className = getClassName(typeDecl);
          if (className) {
            findAnnotations(typeDecl, className);
          }
        }
      });
    }

    return annotations;
  }

  // Helper: extract topic annotations from annotations list
  function extractTopicAnnotationsFromList(annotations: Array<{ annotation: any; className: string }>) {
    for (const { annotation, className } of annotations) {
      // Use the annotation location to extract the full annotation text
      if (annotation.location && annotation.location.startOffset !== undefined && annotation.location.endOffset !== undefined) {
        log(`Annotation location: ${annotation.location.startOffset} to ${annotation.location.endOffset}`);

        if (sourceText) {
          const annotationText = extractSourceAtLocation(sourceText, annotation.location);
          log(`Annotation text: "${annotationText}"`);

          // Check for @Produce.ToTopic and @Consume.FromTopic annotations
          if (annotationText.startsWith('@Produce.ToTopic') || annotationText.startsWith('@Consume.FromTopic')) {
            log(`Found topic annotation in class: ${className}`);

            // Parse both @Produce.ToTopic("topic-name") and @Produce.ToTopic(value = "topic-name", ...) formats
            // Also handle @Consume.FromTopic("topic-name") and @Consume.FromTopic(value = "topic-name", ...) formats
            let topicMatch = annotationText.match(/@(Produce|Consume)\.(To|From)Topic\("([^"]+)"\)/);

            if (!topicMatch) {
              // Try named parameter format: value = "topic-name"
              topicMatch = annotationText.match(/@(Produce|Consume)\.(To|From)Topic\s*\(\s*value\s*=\s*"([^"]+)"[^)]*\)/);
            }

            if (topicMatch) {
              const action = topicMatch[1]; // "Produce" or "Consume"
              const direction = topicMatch[2]; // "To" or "From"
              const topicName = topicMatch[3]; // The topic name

              log(`Found topic annotation - Action: ${action}, Direction: ${direction}, Topic: ${topicName}`);

              // Create topic node if it doesn't exist
              const topicId = `topic:${topicName}`;
              const existingTopic = topicNodes.find((t) => t.id === topicId);
              if (!existingTopic) {
                topicNodes.push({
                  id: topicId,
                  name: topicName,
                  type: 'Topic',
                  uri: vscode.Uri.file(filename),
                });
                log(`Created topic node: ${topicId}`);
              }

              // Create connection between component and topic
              if (action === 'Produce') {
                // Component produces to topic
                connections.push({
                  source: className,
                  target: topicId,
                  label: 'produces to',
                  details: [],
                });
                log(`Created connection: ${className} -> ${topicId} (produces to)`);
              } else if (action === 'Consume') {
                // Component consumes from topic
                connections.push({
                  source: topicId,
                  target: className,
                  label: 'consumes from',
                  details: [],
                });
                log(`Created connection: ${topicId} -> ${className} (consumes from)`);
              }
            } else {
              log(`Could not parse topic annotation: "${annotationText}"`);
            }
          }
        } else {
          log(`No source text provided, cannot extract annotation`);
        }
      } else {
        log(`No location information available for annotation`);
      }
    }
  }

  // Helper: extract service stream annotations from annotations list
  function extractServiceStreamAnnotationsFromList(annotations: Array<{ annotation: any; className: string }>) {
    for (const { annotation, className } of annotations) {
      // Use the annotation location to extract the full annotation text
      if (annotation.location && annotation.location.startOffset !== undefined && annotation.location.endOffset !== undefined) {
        log(`Annotation location: ${annotation.location.startOffset} to ${annotation.location.endOffset}`);

        if (sourceText) {
          const annotationText = extractSourceAtLocation(sourceText, annotation.location);
          log(`Annotation text: "${annotationText}"`);

          // Check for @Produce.ServiceStream and @Consume.FromServiceStream annotations
          if (annotationText.startsWith('@Produce.ServiceStream') || annotationText.startsWith('@Consume.FromServiceStream')) {
            log(`Found service stream annotation in class: ${className}`);

            // Extract parameters (service, id, etc.)
            // Match all key = "value" pairs inside the annotation
            const paramRegex = /(\w+)\s*=\s*"([^"]+)"/g;
            let match;
            let params: Record<string, string> = {};
            while ((match = paramRegex.exec(annotationText)) !== null) {
              params[match[1]] = match[2];
            }

            // Determine the stream name: prefer 'service', fallback to 'id'
            const streamName = params['service'] || params['id'];
            if (!streamName) {
              log(`Could not determine service stream name from annotation: "${annotationText}"`);
              continue;
            }

            // Create service stream node if it doesn't exist
            const streamId = `servicestream:${streamName}`;
            const existingStream = serviceStreamNodes.find((s) => s.id === streamId);
            if (!existingStream) {
              serviceStreamNodes.push({
                id: streamId,
                name: streamName,
                type: 'ServiceStream',
                uri: vscode.Uri.file(filename),
              });
              log(`Created service stream node: ${streamId}`);
            }

            // Determine action (Produce or Consume)
            let action = 'Consume';
            if (/^@Produce\.ServiceStream/.test(annotationText)) action = 'Produce';

            // Create connection between component and service stream
            if (action === 'Produce') {
              // Component produces to service stream
              connections.push({
                source: className,
                target: streamId,
                label: 'produces to',
                details: [],
              });
              log(`Created connection: ${className} -> ${streamId} (produces to)`);
            } else {
              // Component consumes from service stream
              connections.push({
                source: streamId,
                target: className,
                label: 'consumes from',
                details: [],
              });
              log(`Created connection: ${streamId} -> ${className} (consumes from)`);
            }
          }
        }
      } else {
        log(`No location information available for annotation`);
      }
    }
  }

  // Helper: extract consume annotations from annotations list
  function extractConsumeAnnotationsFromList(annotations: Array<{ annotation: any; className: string }>) {
    for (const { annotation, className } of annotations) {
      // Use the annotation location to extract the full annotation text
      if (annotation.location && annotation.location.startOffset !== undefined && annotation.location.endOffset !== undefined) {
        log(`Annotation location: ${annotation.location.startOffset} to ${annotation.location.endOffset}`);

        if (sourceText) {
          const annotationText = extractSourceAtLocation(sourceText, annotation.location);
          log(`Annotation text: "${annotationText}"`);

          // Check if this is a @Consume annotation and parse it
          if (annotationText.startsWith('@Consume')) {
            log(`Found @Consume annotation in class: ${className}`);

            // Parse both @Consume.FromType(ClassName.class) and @Consume.FromType(value = ClassName.class) formats
            const consumeMatch = annotationText.match(/@Consume\.From(\w+)\(([^)]+)\)/);
            if (consumeMatch) {
              const consumeType = consumeMatch[1];
              const sourceClassParam = consumeMatch[2];
              log(`Found consume type: ${consumeType}, source class param: ${sourceClassParam}`);

              // Handle both formats: "ClassName.class" and "value = ClassName.class"
              let sourceClass: string;
              if (sourceClassParam.includes('=')) {
                // Named parameter format: "value = ClassName.class"
                const namedParamMatch = sourceClassParam.match(/value\s*=\s*([^.]+)\.class/);
                if (namedParamMatch) {
                  sourceClass = namedParamMatch[1];
                  log(`Extracted source class from named parameter: ${sourceClass}`);
                } else {
                  log(`Could not parse named parameter format: "${sourceClassParam}"`);
                  continue;
                }
              } else {
                // Direct format: "ClassName.class"
                sourceClass = sourceClassParam.replace(/\.class$/, '');
                log(`Extracted source class from direct format: ${sourceClass}`);
              }

              // Create connection from source class to current class
              let detailLabel: string;
              if (consumeType === 'Topic' || consumeType === 'ServiceStream') {
                detailLabel = `${consumeType} messages`;
              } else {
                detailLabel = `${consumeType} events`;
              }

              connections.push({
                source: sourceClass,
                target: className,
                label: detailLabel,
                details: [],
              });
            } else {
              log(`Could not parse consume annotation: "${annotationText}"`);
            }
          }
        }
      } else {
        log(`No location information available for annotation`);
      }
    }
  }

  if (cst.children && cst.children.ordinaryCompilationUnit && cst.children.ordinaryCompilationUnit[0].children.typeDeclaration) {
    cst.children.ordinaryCompilationUnit[0].children.typeDeclaration.forEach((typeDecl: any) => {
      if (typeDecl.children && typeDecl.children.classDeclaration && typeDecl.children.classDeclaration[0].children.normalClassDeclaration) {
        const classDecl = typeDecl.children.classDeclaration[0];
        const className = getClassName(typeDecl);
        log(`[DEBUG] Processing class: ${className}`);
        if (classDecl.children.normalClassDeclaration[0].children.classBody && classDecl.children.normalClassDeclaration[0].children.classBody[0].children.classBodyDeclaration) {
          const classBodyDecls = classDecl.children.normalClassDeclaration[0].children.classBody[0].children.classBodyDeclaration;
          const clientFieldNames = findComponentClientFieldNames(classBodyDecls);
          if (clientFieldNames.length > 0) {
            log(`Found ComponentClient field names in ${className}: ${clientFieldNames.join(', ')}`);
          } else {
            log(`No ComponentClient field names found in ${className}`);
          }

          if (className) {
            log(`[DEBUG] Entering className block for: ${className}`);
            log(`========================================`);
            log(`PROCESSING CLASS: ${className}`);
            log(`========================================`);

            log(`--- Stage 1: Function Tool Annotations ---`);
            findFunctionToolAnnotations(classBodyDecls, className);
            log(`--- Stage 1 Complete ---`);

            log(`--- Stage 2: Tool Field Declarations ---`);
            findToolFieldDeclarations(classBodyDecls, className);
            log(`--- Stage 2 Complete ---`);

            // Component reference detection will be done after all components are detected
          }

          classBodyDecls.forEach((bodyDecl: any) => {
            if (bodyDecl.children && bodyDecl.children.classMemberDeclaration && bodyDecl.children.classMemberDeclaration[0].children.methodDeclaration) {
              const methodDecl = bodyDecl.children.classMemberDeclaration[0].children.methodDeclaration[0];
              if (methodDecl.children.methodBody && methodDecl.children.methodBody[0].children.block && methodDecl.children.methodBody[0].children.block[0].children.blockStatements) {
                if (className) {
                  methodDecl.children.methodBody[0].children.block[0].children.blockStatements.forEach((blockStmt: any) => {
                    findComponentClientChains(blockStmt, className, clientFieldNames);
                    findFunctionToolInvocations(blockStmt, className);
                  });
                }
              }
            }
          });
        }
      }
    });
  }

  // Extract all annotations and process consume, topic, and service stream annotations
  log(`========================================`);
  log(`STAGE 4: ANNOTATION PROCESSING`);
  log(`========================================`);
  log(`Extracting all annotations from CST...`);
  const allAnnotations = extractAllAnnotations(cst);
  log(`Found ${allAnnotations.length} total annotations`);
  extractConsumeAnnotationsFromList(allAnnotations);
  extractTopicAnnotationsFromList(allAnnotations);
  extractServiceStreamAnnotationsFromList(allAnnotations);
  findToolClassDefinitions(cst);
  log(`--- Stage 4 Complete ---`);

  // Stage 5: Component Reference Detection (after all components are detected)
  log(`========================================`);
  log(`STAGE 5: COMPONENT REFERENCE DETECTION`);
  log(`========================================`);

  // Build complete list of all components including function tools
  const allComponentsForReference = [...(allComponents || [])];

  // Add function tool classes detected in this file
  toolNodes.forEach((tool) => {
    const toolClassName = tool.name.split('.')[0]; // Extract class name from tool name
    if (!allComponentsForReference.find((c) => c.className === toolClassName)) {
      allComponentsForReference.push({
        className: toolClassName,
        componentType: 'FunctionTool',
      });
    }
  });

  log(`Total components for reference detection: ${allComponentsForReference.length}`);
  allComponentsForReference.forEach((comp, index) => {
    log(`  Component ${index + 1}: ${comp.className} (${comp.componentType})`);
  });

  // Now scan each class for references to other components
  if (cst.children && cst.children.ordinaryCompilationUnit && cst.children.ordinaryCompilationUnit[0].children.typeDeclaration) {
    cst.children.ordinaryCompilationUnit[0].children.typeDeclaration.forEach((typeDecl: any) => {
      if (typeDecl.children && typeDecl.children.classDeclaration && typeDecl.children.classDeclaration[0].children.normalClassDeclaration) {
        const classDecl = typeDecl.children.classDeclaration[0];
        const className = getClassName(typeDecl);

        if (className && allComponentsForReference.length > 0) {
          log(`Scanning ${className} for references to ${allComponentsForReference.length} components...`);
          findComponentReferences(cst, allComponentsForReference, className);
        }
      }
    });
  }

  log(`--- Stage 5 Complete ---`);

  // Final results summary
  log(`========================================`);
  log(`CST-BASED EDGE DETECTION COMPLETE FOR: ${filename}`);
  log(`========================================`);
  log(`Final Results:`);
  log(`  - Connections found: ${connections.length}`);
  log(`  - Topic nodes found: ${topicNodes.length}`);
  log(`  - Service stream nodes found: ${serviceStreamNodes.length}`);
  log(`  - Tool nodes found: ${toolNodes.length}`);

  if (connections.length > 0) {
    log(`  - Connection details:`);
    connections.forEach((conn, index) => {
      log(`    ${index + 1}. ${conn.source} -> ${conn.target} (${conn.label})`);
    });
  }

  return { connections, topicNodes, serviceStreamNodes, toolNodes };
}

// Helper: detect function tool classes from CST
export function detectFunctionToolClasses(cst: any, filename: string, sourceText?: string, outputChannel?: vscode.OutputChannel) {
  const log = outputChannel ? createPrefixedLogger(outputChannel, '[FunctionToolDetection]') : console.log;

  log(`========================================`);
  log(`DETECTING FUNCTION TOOL CLASSES FOR: ${filename}`);
  log(`========================================`);

  const functionToolClasses: Array<{ className: string; componentType: string; filename: string }> = [];

  if (!cst.children || !cst.children.ordinaryCompilationUnit) {
    log(`No compilation unit found in CST`);
    return functionToolClasses;
  }

  const compilationUnit = cst.children.ordinaryCompilationUnit[0];
  if (!compilationUnit.children || !compilationUnit.children.typeDeclaration) {
    log(`No type declarations found in compilation unit`);
    return functionToolClasses;
  }

  for (const typeDecl of compilationUnit.children.typeDeclaration) {
    if (typeDecl.children && typeDecl.children.classDeclaration) {
      const classDecl = typeDecl.children.classDeclaration[0];
      if (classDecl.children && classDecl.children.normalClassDeclaration) {
        const normalClass = classDecl.children.normalClassDeclaration[0];

        // Extract class name
        let className = null;
        if (normalClass.children && normalClass.children.typeIdentifier) {
          const typeId = normalClass.children.typeIdentifier[0];
          if (typeId.image) {
            className = typeId.image;
          } else if (typeId.children && typeId.children.Identifier) {
            className = typeId.children.Identifier[0].image;
          }
        }

        if (!className) {
          log(`Could not extract class name from class declaration`);
          continue;
        }

        log(`Checking class: ${className} for @FunctionTool annotation`);

        // Check for @FunctionTool annotation
        if (normalClass.children && normalClass.children.classBody) {
          const classBody = normalClass.children.classBody[0];
          if (classBody.children && classBody.children.classBodyDeclaration) {
            const classBodyDecls = classBody.children.classBodyDeclaration;

            // Check for @FunctionTool annotation on the class
            let hasFunctionToolAnnotation = false;

            for (const bodyDecl of classBodyDecls) {
              if (bodyDecl.children && bodyDecl.children.classMemberDeclaration) {
                const memberDecl = bodyDecl.children.classMemberDeclaration[0];
                if (memberDecl.children && memberDecl.children.methodDeclaration) {
                  const methodDecl = memberDecl.children.methodDeclaration[0];
                  if (methodDecl.children && methodDecl.children.methodModifier) {
                    for (const modifier of methodDecl.children.methodModifier) {
                      if (modifier.children && modifier.children.annotation) {
                        for (const annotation of modifier.children.annotation) {
                          if (annotation.location && sourceText) {
                            const annotationText = extractSourceAtLocation(sourceText, annotation.location);
                            if (annotationText.startsWith('@FunctionTool')) {
                              hasFunctionToolAnnotation = true;
                              log(`Found @FunctionTool annotation on method in class: ${className}`);
                              break;
                            }
                          }
                        }
                        if (hasFunctionToolAnnotation) break;
                      }
                    }
                    if (hasFunctionToolAnnotation) break;
                  }
                }
              }
            }

            // Also check for @FunctionTool annotation on the class itself
            if (!hasFunctionToolAnnotation && classDecl.children && classDecl.children.classModifier) {
              for (const modifier of classDecl.children.classModifier) {
                if (modifier.children && modifier.children.annotation) {
                  for (const annotation of modifier.children.annotation) {
                    if (annotation.location && sourceText) {
                      const annotationText = extractSourceAtLocation(sourceText, annotation.location);
                      if (annotationText.startsWith('@FunctionTool')) {
                        hasFunctionToolAnnotation = true;
                        log(`Found @FunctionTool annotation on class: ${className}`);
                        break;
                      }
                    }
                  }
                  if (hasFunctionToolAnnotation) break;
                }
              }
            }

            if (hasFunctionToolAnnotation) {
              log(`Adding function tool class: ${className}`);
              functionToolClasses.push({
                className: className,
                componentType: 'FunctionTool',
                filename: filename,
              });
            }
          }
        }
      }
    }
  }

  log(`Found ${functionToolClasses.length} function tool classes:`);
  functionToolClasses.forEach((toolClass, index) => {
    log(`  ${index + 1}. ${toolClass.className} (${toolClass.componentType})`);
  });

  log(`========================================`);
  log(`FUNCTION TOOL CLASS DETECTION COMPLETE`);
  log(`========================================`);

  return functionToolClasses;
}
