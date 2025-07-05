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
export function extractComponentConnectionsFromCST(cst: any, filename: string, sourceText?: string, outputChannel?: vscode.OutputChannel) {
  const log = outputChannel ? createPrefixedLogger(outputChannel, '[CSTUtils]') : console.log;

  const connections: Array<{
    source: string;
    target: string;
    label: string;
    details: string[];
  }> = [];
  const topicNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];
  const serviceStreamNodes: Array<{ id: string; name: string; type: string; uri: vscode.Uri }> = [];

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
        // Find parameters
        if (ctor.children.constructorDeclarator && ctor.children.constructorDeclarator[0].children.formalParameterList) {
          const params = ctor.children.constructorDeclarator[0].children.formalParameterList[0];
          if (params.children.formalParameter) {
            for (const param of params.children.formalParameter) {
              // Look for type ComponentClient - updated path based on debug output
              if (
                param.children &&
                param.children.variableParaRegularParameter &&
                param.children.variableParaRegularParameter[0].children.unannType &&
                param.children.variableParaRegularParameter[0].children.unannType[0].children.unannReferenceType &&
                param.children.variableParaRegularParameter[0].children.unannType[0].children.unannReferenceType[0].children.unannClassOrInterfaceType &&
                param.children.variableParaRegularParameter[0].children.unannType[0].children.unannReferenceType[0].children.unannClassOrInterfaceType[0].children.unannClassType &&
                param.children.variableParaRegularParameter[0].children.unannType[0].children.unannReferenceType[0].children.unannClassOrInterfaceType[0].children.unannClassType[0].children
                  .Identifier &&
                param.children.variableParaRegularParameter[0].children.unannType[0].children.unannReferenceType[0].children.unannClassOrInterfaceType[0].children.unannClassType[0].children.Identifier[0].image.includes(
                  'ComponentClient'
                )
              ) {
                // Get parameter name
                if (
                  param.children.variableParaRegularParameter[0].children.variableDeclaratorId &&
                  param.children.variableParaRegularParameter[0].children.variableDeclaratorId[0].children.Identifier
                ) {
                  const paramName = param.children.variableParaRegularParameter[0].children.variableDeclaratorId[0].children.Identifier[0].image;
                  // Now, look for assignments in the constructor body: this.FIELD = paramName;
                  if (ctor.children.constructorBody && ctor.children.constructorBody[0].children.blockStatements) {
                    for (const blockStmt of ctor.children.constructorBody[0].children.blockStatements) {
                      if (
                        blockStmt.children &&
                        blockStmt.children.blockStatement &&
                        blockStmt.children.blockStatement[0].children.statement &&
                        blockStmt.children.blockStatement[0].children.statement[0].children.statementWithoutTrailingSubstatement &&
                        blockStmt.children.blockStatement[0].children.statement[0].children.statementWithoutTrailingSubstatement[0].children.expressionStatement &&
                        blockStmt.children.blockStatement[0].children.statement[0].children.statementWithoutTrailingSubstatement[0].children.expressionStatement[0].children.statementExpression &&
                        blockStmt.children.blockStatement[0].children.statement[0].children.statementWithoutTrailingSubstatement[0].children.expressionStatement[0].children.statementExpression[0]
                          .children.expression
                      ) {
                        const expr =
                          blockStmt.children.blockStatement[0].children.statement[0].children.statementWithoutTrailingSubstatement[0].children.expressionStatement[0].children.statementExpression[0]
                            .children.expression[0];

                        // Look deeper into the expression structure
                        if (expr.children.conditionalExpression) {
                          const condExpr = expr.children.conditionalExpression[0];

                          if (condExpr.children.binaryExpression) {
                            const binExpr = condExpr.children.binaryExpression[0];

                            if (binExpr.children.unaryExpression) {
                              const unaryExpr = binExpr.children.unaryExpression[0];

                              if (unaryExpr.children.primary) {
                                const primary = unaryExpr.children.primary[0];

                                if (primary.children.primaryPrefix) {
                                  const prefix = primary.children.primaryPrefix[0];

                                  if (prefix.children.This) {
                                    // Found 'this'
                                  }
                                }

                                if (primary.children.primarySuffix) {
                                  const suffix = primary.children.primarySuffix[0];

                                  if (suffix.children.Identifier) {
                                    const fieldName = suffix.children.Identifier[0].image;
                                  }
                                }
                              }
                            }

                            if (binExpr.children.AssignmentOperator) {
                              const assignOp = binExpr.children.AssignmentOperator[0];
                            }

                            if (binExpr.children.expression) {
                              const rhs = binExpr.children.expression[0];

                              // Look deeper into RHS to find the variable name
                              if (rhs.children.conditionalExpression) {
                                const rhsCond = rhs.children.conditionalExpression[0];

                                if (rhsCond.children.binaryExpression) {
                                  const rhsBin = rhsCond.children.binaryExpression[0];

                                  if (rhsBin.children.unaryExpression) {
                                    const rhsUnary = rhsBin.children.unaryExpression[0];

                                    if (rhsUnary.children.primary && rhsUnary.children.primary[0].children.primaryPrefix) {
                                      const prefix = rhsUnary.children.primary[0].children.primaryPrefix[0];

                                      if (prefix.children.Identifier) {
                                        const varName = prefix.children.Identifier[0].image;
                                      }

                                      if (prefix.children.fqnOrRefType) {
                                        const fqn = prefix.children.fqnOrRefType[0];

                                        if (fqn.children && fqn.children.fqnOrRefTypePartFirst) {
                                          const partFirst = fqn.children.fqnOrRefTypePartFirst[0];

                                          if (partFirst.children && partFirst.children.fqnOrRefTypePartCommon) {
                                            const partCommon = partFirst.children.fqnOrRefTypePartCommon[0];
                                            if (partCommon.children && partCommon.children.Identifier) {
                                              const varName = partFirst.children.fqnOrRefTypePartCommon[0].children.Identifier[0].image;
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

                        // Check if this is an assignment: this.FIELD = paramName
                        if (
                          expr.children.conditionalExpression &&
                          expr.children.conditionalExpression[0].children.binaryExpression &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.unaryExpression &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.unaryExpression[0].children.primary &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.unaryExpression[0].children.primary[0].children.primaryPrefix &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.unaryExpression[0].children.primary[0].children.primaryPrefix[0].children.This &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.unaryExpression[0].children.primary[0].children.primarySuffix &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.unaryExpression[0].children.primary[0].children.primarySuffix[0].children.Identifier &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.unaryExpression[0].children.primary[0].children.primarySuffix[0].children.Identifier[0].image &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.AssignmentOperator &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression[0].children.conditionalExpression &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression[0].children.conditionalExpression[0].children.binaryExpression &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression[0].children.conditionalExpression[0].children.binaryExpression[0].children
                            .unaryExpression &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression[0].children.conditionalExpression[0].children.binaryExpression[0].children
                            .unaryExpression[0].children.primary &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression[0].children.conditionalExpression[0].children.binaryExpression[0].children
                            .unaryExpression[0].children.primary[0].children.primaryPrefix &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression[0].children.conditionalExpression[0].children.binaryExpression[0].children
                            .unaryExpression[0].children.primary[0].children.primaryPrefix[0].children.fqnOrRefType &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression[0].children.conditionalExpression[0].children.binaryExpression[0].children
                            .unaryExpression[0].children.primary[0].children.primaryPrefix[0].children.fqnOrRefType[0].children.fqnOrRefTypePartFirst &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression[0].children.conditionalExpression[0].children.binaryExpression[0].children
                            .unaryExpression[0].children.primary[0].children.primaryPrefix[0].children.fqnOrRefType[0].children.fqnOrRefTypePartFirst[0].children.fqnOrRefTypePartCommon &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression[0].children.conditionalExpression[0].children.binaryExpression[0].children
                            .unaryExpression[0].children.primary[0].children.primaryPrefix[0].children.fqnOrRefType[0].children.fqnOrRefTypePartFirst[0].children.fqnOrRefTypePartCommon[0].children
                            .Identifier &&
                          expr.children.conditionalExpression[0].children.binaryExpression[0].children.expression[0].children.conditionalExpression[0].children.binaryExpression[0].children
                            .unaryExpression[0].children.primary[0].children.primaryPrefix[0].children.fqnOrRefType[0].children.fqnOrRefTypePartFirst[0].children.fqnOrRefTypePartCommon[0].children
                            .Identifier[0].image === paramName
                        ) {
                          // The field assigned is:
                          const fieldName =
                            expr.children.conditionalExpression[0].children.binaryExpression[0].children.unaryExpression[0].children.primary[0].children.primarySuffix[0].children.Identifier[0].image;
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

    // Fallback: if no field names found, try to find any field that might be a ComponentClient
    if (fieldNames.length === 0) {
      log(`No ComponentClient field names found with complex detection, trying fallback...`);
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

    log(`ComponentClient field names found: ${fieldNames.join(', ')}`);
    return fieldNames;
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
                      const hasInvokeCall = chain.some((method) => method === 'invoke' || method === 'invokeAsync');

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
                              } else {
                                log(`No location information available for method invocation`);
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
                          } else {
                            log(`No argument list found in method invocation`);
                            // Try to extract method parameter from the method invocation itself
                            if (methodInv.location && sourceText) {
                              const methodInvText = extractSourceAtLocation(sourceText, methodInv.location);
                              log(`Method invocation text: "${methodInvText}"`);

                              // Try to extract the argument from the method invocation text
                              const argMatch = methodInvText.match(/\(([^)]+)\)/);
                              if (argMatch) {
                                const argText = argMatch[1];
                                log(`Extracted argument text: "${argText}"`);

                                const parts = argText.split('::');
                                if (parts.length === 2) {
                                  targetComponentType = parts[0];
                                  calledMethodName = parts[1];
                                  log(`Extracted from method invocation text - Class: ${targetComponentType}, Method: ${calledMethodName}`);
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
        } else {
          log(`No source text provided, cannot extract annotation`);
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
              const detailLabel = consumeType === 'Topic' || consumeType === 'ServiceStream' ? 'consumes' : `${consumeType} events`;
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
        } else {
          log(`No source text provided, cannot extract annotation`);
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
        if (classDecl.children.normalClassDeclaration[0].children.classBody && classDecl.children.normalClassDeclaration[0].children.classBody[0].children.classBodyDeclaration) {
          const classBodyDecls = classDecl.children.normalClassDeclaration[0].children.classBody[0].children.classBodyDeclaration;
          const clientFieldNames = findComponentClientFieldNames(classBodyDecls);
          log(`Found ComponentClient field names in ${className}: ${clientFieldNames.join(', ')}`);

          classBodyDecls.forEach((bodyDecl: any) => {
            if (bodyDecl.children && bodyDecl.children.classMemberDeclaration && bodyDecl.children.classMemberDeclaration[0].children.methodDeclaration) {
              const methodDecl = bodyDecl.children.classMemberDeclaration[0].children.methodDeclaration[0];
              if (methodDecl.children.methodBody && methodDecl.children.methodBody[0].children.block && methodDecl.children.methodBody[0].children.block[0].children.blockStatements) {
                if (className) {
                  methodDecl.children.methodBody[0].children.block[0].children.blockStatements.forEach((blockStmt: any) => {
                    findComponentClientChains(blockStmt, className, clientFieldNames);
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
  log(`Extracting all annotations from CST...`);
  const allAnnotations = extractAllAnnotations(cst);
  log(`Found ${allAnnotations.length} total annotations`);
  extractConsumeAnnotationsFromList(allAnnotations);
  extractTopicAnnotationsFromList(allAnnotations);
  extractServiceStreamAnnotationsFromList(allAnnotations);

  return { connections, topicNodes, serviceStreamNodes };
}
