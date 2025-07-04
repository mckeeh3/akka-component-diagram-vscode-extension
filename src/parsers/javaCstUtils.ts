import { parse } from 'java-parser';
import { AkkaComponent, AkkaEdge } from '../models/types';

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
 * @returns Array of connections: { sourceClass, targetType, targetClass, methodName, location }
 */
export function extractComponentConnectionsFromCST(cst: any, filename: string, sourceText?: string) {
  const connections: Array<{
    source: string;
    target: string;
    label: string;
    details: string[];
  }> = [];

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
                            }
                          }
                        }
                      }

                      // Extract subsequent method names from primarySuffix
                      for (let i = 0; i < suffixes.length; i++) {
                        const suffix = suffixes[i];
                        if (suffix.children && suffix.children.Dot && suffix.children.Identifier) {
                          // Extract method name from Dot.Identifier
                          const methodName = suffix.children.Identifier[0].image;
                          chain.push(methodName);
                        }
                      }

                      // Look for for* -> method -> invoke pattern
                      console.log(`[CST] Checking chain: ${chain.join(' -> ')}`);
                      if (
                        chain.length >= 3 &&
                        (chain[0].startsWith('for') || chain[0] === 'forView' || chain[0] === 'forEventSourcedEntity') &&
                        chain[1] === 'method' &&
                        (chain[2] === 'invoke' || chain[2] === 'invokeAsync')
                      ) {
                        console.log(`[CST] Found valid chain pattern: ${chain.join(' -> ')}`);
                        // Extract target component type and method name from the method reference argument
                        let targetComponentType = '';
                        let calledMethodName = '';
                        if (suffixes.length >= 3 && suffixes[2].children && suffixes[2].children.methodInvocationSuffix) {
                          const methodInv = suffixes[2].children.methodInvocationSuffix[0];
                          if (methodInv.children && methodInv.children.argumentList) {
                            const argList = methodInv.children.argumentList[0];
                            if (argList.children && argList.children.expression) {
                              const expr = argList.children.expression[0];

                              // Use the location offsets to extract the method parameter directly from source text
                              if (methodInv.location && methodInv.location.startOffset !== undefined && methodInv.location.endOffset !== undefined) {
                                console.log(`[CST] Method invocation location: ${methodInv.location.startOffset} to ${methodInv.location.endOffset}`);

                                // Extract the method parameter text directly from source
                                if (sourceText) {
                                  const methodParamText = extractSourceAtLocation(sourceText, methodInv.location);
                                  console.log(`[CST] Method parameter text: "${methodParamText}"`);

                                  // Remove parentheses from the extracted text
                                  const cleanParamText = methodParamText.replace(/^\(|\)$/g, '');
                                  console.log(`[CST] Clean parameter text: "${cleanParamText}"`);

                                  // Parse the ClassName::methodName format
                                  const parts = cleanParamText.split('::');
                                  if (parts.length === 2) {
                                    targetComponentType = parts[0];
                                    calledMethodName = parts[1];
                                    console.log(`[CST] Extracted from text - Class: ${targetComponentType}, Method: ${calledMethodName}`);
                                  } else {
                                    console.log(`[CST] Could not parse method parameter: "${cleanParamText}"`);
                                  }
                                } else {
                                  console.log(`[CST] No source text provided, cannot extract method name`);
                                }
                              } else {
                                console.log(`[CST] No location information available for method invocation`);
                              }
                            }
                          }
                        }

                        // Method name extraction is now done in the same loop where we find the class name

                        if (targetComponentType) {
                          const details = []; // Start with empty details array
                          if (calledMethodName) {
                            details.push(calledMethodName); // Add only the called method name
                          }
                          console.log(`[CST] Found connection: ${className} -> ${targetComponentType} (${calledMethodName})`);
                          console.log(`[CST] Chain: ${chain.join(' -> ')}`);
                          console.log(`[CST] Called method name: ${calledMethodName}`);
                          console.log(`[CST] Details array: ${JSON.stringify(details)}`);
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

  // Helper: extract consume annotations from annotations list
  function extractConsumeAnnotationsFromList(annotations: Array<{ annotation: any; className: string }>) {
    for (const { annotation, className } of annotations) {
      // Use the annotation location to extract the full annotation text
      if (annotation.location && annotation.location.startOffset !== undefined && annotation.location.endOffset !== undefined) {
        console.log(`[CST] Annotation location: ${annotation.location.startOffset} to ${annotation.location.endOffset}`);

        if (sourceText) {
          const annotationText = extractSourceAtLocation(sourceText, annotation.location);
          console.log(`[CST] Annotation text: "${annotationText}"`);

          // Check if this is a @Consume annotation and parse it
          if (annotationText.startsWith('@Consume')) {
            console.log(`[CST] Found @Consume annotation in class: ${className}`);

            // Parse the @Consume.FromType(ClassName.class) format
            const consumeMatch = annotationText.match(/@Consume\.From(\w+)\(([^)]+)\)/);
            if (consumeMatch) {
              const consumeType = consumeMatch[1];
              const sourceClassParam = consumeMatch[2];
              console.log(`[CST] Found consume type: ${consumeType}, source class param: ${sourceClassParam}`);

              // Extract the class name from the parameter (remove .class if present)
              const sourceClass = sourceClassParam.replace(/\.class$/, '');
              console.log(`[CST] Extracted source class: ${sourceClass}`);

              // Create connection from source class to current class
              const detailLabel = consumeType === 'Topic' || consumeType === 'ServiceStream' ? 'consumes' : `${consumeType} events`;
              connections.push({
                source: sourceClass,
                target: className,
                label: detailLabel,
                details: [],
              });
            } else {
              console.log(`[CST] Could not parse consume annotation: "${annotationText}"`);
            }
          }
        } else {
          console.log(`[CST] No source text provided, cannot extract annotation`);
        }
      } else {
        console.log(`[CST] No location information available for annotation`);
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
          console.log(`[CST] Found ComponentClient field names in ${className}: ${clientFieldNames.join(', ')}`);

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

  // Extract all annotations and process consume annotations
  console.log(`[CST] Extracting all annotations from CST...`);
  const allAnnotations = extractAllAnnotations(cst);
  console.log(`[CST] Found ${allAnnotations.length} total annotations`);
  extractConsumeAnnotationsFromList(allAnnotations);

  return connections;
}
