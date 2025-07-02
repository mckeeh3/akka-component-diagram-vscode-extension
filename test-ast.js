const javaParser = require('java-parser');

// Simple Java code with annotations for testing
const testJavaCode = `
package com.example;

import java.util.List;

@ComponentId("my-component")
@HttpEndpoint("/api/v1")
@GrpcEndpoint
public class MyComponent extends EventSourcedEntity {
    
    @GrpcEndpoint("service1")
    public void method1() {
        // method body
    }
    
    @MCPEndpoint(name="service2", port=8080)
    public void method2() {
        // method body
    }
}

@ComponentId("my-agent")
@HttpEndpoint
public class MyAgent extends Agent {
    // agent implementation
}

@ComponentId("my-view")
@MCPEndpoint(name="view-service")
public class MyView extends View {
    // view implementation
}
`;

// Recursive function to find all nodes with a specific name
function findNodesByName(node, targetName, results = []) {
  if (node.name === targetName) {
    results.push(node);
  }

  if (node.children) {
    for (const [key, value] of Object.entries(node.children)) {
      if (Array.isArray(value)) {
        value.forEach((child) => {
          if (child && typeof child === 'object') {
            findNodesByName(child, targetName, results);
          }
        });
      } else if (value && typeof value === 'object') {
        findNodesByName(value, targetName, results);
      }
    }
  }

  return results;
}

// Recursive function to find all annotation nodes
function findAllAnnotations(node, results = []) {
  if (node.name === 'annotation') {
    results.push(node);
  }

  if (node.children) {
    for (const [key, value] of Object.entries(node.children)) {
      if (Array.isArray(value)) {
        value.forEach((child) => {
          if (child && typeof child === 'object') {
            findAllAnnotations(child, results);
          }
        });
      } else if (value && typeof value === 'object') {
        findAllAnnotations(value, results);
      }
    }
  }

  return results;
}

// Extract all annotation info (name, arguments, location) from a CST node
function extractAnnotationsFromCST(node) {
  const results = [];

  // Helper function to extract string values from complex elementValue structures
  function extractStringValueFromElementValue(elementValue) {
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
      console.debug('Error extracting string value:', error);
    }
    return null;
  }

  function recurse(n) {
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
      let args = [];
      if (n.children && n.children.elementValue) {
        // Single argument (e.g., @Anno("foo"))
        args = n.children.elementValue.map((ev) => {
          // Try to extract the actual string value from the complex JSON structure
          const stringValue = extractStringValueFromElementValue(ev);
          return stringValue || JSON.stringify(ev);
        });
      } else if (n.children && n.children.elementValuePairList) {
        // Named arguments (e.g., @Anno(key="value"))
        args = n.children.elementValuePairList.map((pair) => {
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

// Function to extract Akka component information from CST
function extractAkkaComponentsFromCST(node, filename) {
  const components = [];
  const akkaSuperclasses = ['Agent', 'EventSourcedEntity', 'KeyValueEntity', 'View', 'Consumer', 'Workflow', 'TimedAction'];
  const endpointAnnotations = ['HttpEndpoint', 'GrpcEndpoint', 'MCPEndpoint'];

  function printTypeIdentifierInfo(typeIdentifier) {
    if (!typeIdentifier) return;
    console.log('\n--- typeIdentifier node ---');
    console.log('Keys:', Object.keys(typeIdentifier));
    if (typeIdentifier.image) console.log('image:', typeIdentifier.image);
    if (typeIdentifier.children && typeIdentifier.children.Identifier) {
      console.log('Identifier child:', typeIdentifier.children.Identifier[0]);
    }
  }
  function printClassExtendsInfo(classExtends) {
    if (!classExtends) return;
    console.log('\n--- classExtends node ---');
    console.log('Keys:', Object.keys(classExtends));
    if (classExtends.image) console.log('image:', classExtends.image);
    if (classExtends.children) {
      console.log('Children keys:', Object.keys(classExtends.children));
      for (const [key, value] of Object.entries(classExtends.children)) {
        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            console.log(`${key}[${index}]:`, item);
          });
        } else {
          console.log(`${key}:`, value);
        }
      }
    }
  }

  function recurse(n) {
    if (n && n.name === 'classDeclaration') {
      let className = '';
      let superclassName = '';
      if (n.children && n.children.normalClassDeclaration && n.children.normalClassDeclaration[0]) {
        const classDecl = n.children.normalClassDeclaration[0];
        // Print typeIdentifier info
        if (classDecl.children && classDecl.children.typeIdentifier && classDecl.children.typeIdentifier[0]) {
          printTypeIdentifierInfo(classDecl.children.typeIdentifier[0]);
        }
        // Print classExtends info
        if (classDecl.children && classDecl.children.classExtends && classDecl.children.classExtends[0]) {
          printClassExtendsInfo(classDecl.children.classExtends[0]);
        }
        // Extract class name from typeIdentifier.children.Identifier[0].image
        if (classDecl.children && classDecl.children.typeIdentifier && classDecl.children.typeIdentifier[0]) {
          const typeIdentifier = classDecl.children.typeIdentifier[0];
          if (typeIdentifier.children && typeIdentifier.children.Identifier && typeIdentifier.children.Identifier[0]) {
            className = typeIdentifier.children.Identifier[0].image || '';
          }
        }
        // Extract superclass from classExtends
        if (classDecl.children && classDecl.children.classExtends && classDecl.children.classExtends[0]) {
          const classExtends = classDecl.children.classExtends[0];
          // Look for superclass in classType.children.Identifier[0].image
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
                  const stringValue = extractStringValueFromElementValue(ev);
                  componentIdValue = stringValue || '';
                }
              } else if (endpointAnnotations.includes(annotationName)) {
                endpointType = annotationName;
                // Extract endpoint value - handle different argument formats
                if (annotation.children && annotation.children.elementValue) {
                  // Single argument (e.g., @HttpEndpoint("/path"))
                  const ev = annotation.children.elementValue[0];
                  const stringValue = extractStringValueFromElementValue(ev);
                  endpointValue = stringValue || '';
                } else if (annotation.children && annotation.children.elementValuePairList) {
                  // Named arguments (e.g., @MCPEndpoint(name="service", port=8080))
                  const pairs = annotation.children.elementValuePairList;
                  const namePair = pairs.find((pair) => pair.children && pair.children.Identifier && pair.children.Identifier[0] && pair.children.Identifier[0].image === 'name');
                  if (namePair && namePair.children && namePair.children.elementValue) {
                    const ev = namePair.children.elementValue[0];
                    const stringValue = extractStringValueFromElementValue(ev);
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

// Helper function to extract string values from complex elementValue structures
function extractStringValueFromElementValue(elementValue) {
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
    console.debug('Error extracting string value:', error);
  }
  return null;
}

try {
  console.log('Parsing Java code...');
  const ast = javaParser.parse(testJavaCode);

  console.log('\n=== CST Structure ===');
  console.log('Top-level keys:', Object.keys(ast));
  console.log('Root node name:', ast.name);

  console.log('\n=== Testing extractAnnotationsFromCST Function ===');
  const extractedAnnotations = extractAnnotationsFromCST(ast);
  console.log(`Found ${extractedAnnotations.length} annotations using extractAnnotationsFromCST:`);

  extractedAnnotations.forEach((annotation, i) => {
    console.log(`\nAnnotation ${i + 1}:`);
    console.log('  Name:', annotation.name);
    if (annotation.arguments) {
      console.log('  Arguments:', annotation.arguments);
    }
    if (annotation.location) {
      console.log('  Location:', `line ${annotation.location.startLine}, col ${annotation.location.startColumn}`);
    }
  });

  // Look for Akka-specific annotations
  const akkaAnnotations = ['ComponentId', 'HttpEndpoint', 'GrpcEndpoint', 'MCPEndpoint'];
  const foundAkkaAnnotations = extractedAnnotations.filter((ann) => akkaAnnotations.includes(ann.name));

  console.log(`\n=== Akka Annotations Found ===`);
  console.log(`Found ${foundAkkaAnnotations.length} Akka-specific annotations:`);
  foundAkkaAnnotations.forEach((annotation, i) => {
    console.log(`  ${i + 1}. ${annotation.name}`);
    if (annotation.arguments) {
      console.log(`     Arguments: ${annotation.arguments.join(', ')}`);
    }
  });

  console.log('\n=== Testing extractAkkaComponentsFromCST Function ===');
  const akkaComponents = extractAkkaComponentsFromCST(ast, 'test-file.java');
  console.log(`\nFound ${akkaComponents.length} Akka components:`);
  akkaComponents.forEach((component, i) => {
    console.log(`  ${i + 1}. ${component.className} (${component.componentType}) - ID: ${component.componentId}`);
  });
} catch (error) {
  console.error('Parse error:', error);
}
