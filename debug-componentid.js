const fs = require('fs');
const path = require('path');
const javaParser = require('java-parser');

// Test with a specific file that has @ComponentId
const testFile = 'test-samples/key-value-customer-registry/src/main/java/customer/application/CustomerEntity.java';

console.log('=== Debugging @ComponentId Detection ===\n');

try {
  const content = fs.readFileSync(testFile, 'utf8');
  console.log('File content (first 200 chars):');
  console.log(content.substring(0, 200));
  console.log('\n' + '='.repeat(50) + '\n');

  const cst = javaParser.parse(content);

  // Function to extract Akka components from CST (same as in test-samples.js)
  function extractAkkaComponentsFromCST(node, filename) {
    const components = [];
    const akkaSuperclasses = ['Agent', 'EventSourcedEntity', 'KeyValueEntity', 'View', 'Consumer', 'Workflow', 'TimedAction'];
    const endpointAnnotations = ['HttpEndpoint', 'GrpcEndpoint', 'MCPEndpoint'];

    function recurse(n) {
      if (n && n.name === 'classDeclaration') {
        console.log('\n--- Found classDeclaration ---');
        console.log('Class declaration children keys:', Object.keys(n.children || {}));

        let className = '';
        let superclassName = '';
        let hasComponentId = false;
        let componentIdValue = '';
        let endpointType = '';
        let endpointValue = '';

        // Extract class name
        if (n.children && n.children.typeIdentifier && n.children.typeIdentifier[0]) {
          const typeIdentifier = n.children.typeIdentifier[0];
          if (typeIdentifier.children && typeIdentifier.children.Identifier && typeIdentifier.children.Identifier[0]) {
            className = typeIdentifier.children.Identifier[0].image || '';
            console.log('Class name:', className);
          }
        }

        // Extract superclass from classExtends - check inside normalClassDeclaration
        if (n.children && n.children.normalClassDeclaration && n.children.normalClassDeclaration[0]) {
          const normalClass = n.children.normalClassDeclaration[0];
          console.log('Normal class declaration found:', normalClass);
          console.log('Normal class children keys:', Object.keys(normalClass.children || {}));

          if (normalClass.children && normalClass.children.classExtends && normalClass.children.classExtends[0]) {
            const classExtends = normalClass.children.classExtends[0];
            console.log('Class extends found:', classExtends);
            console.log('Class extends children keys:', Object.keys(classExtends.children || {}));
            if (classExtends.children && classExtends.children.classType && classExtends.children.classType[0]) {
              const classType = classExtends.children.classType[0];
              console.log('Class type:', classType);
              console.log('Class type children keys:', Object.keys(classType.children || {}));
              // Handle generics: Identifier may be direct child or inside typeArguments
              if (classType.children && classType.children.Identifier && classType.children.Identifier[0]) {
                superclassName = classType.children.Identifier[0].image || '';
                console.log('Superclass name:', superclassName);
              } else if (classType.children && classType.children.classOrInterfaceType && classType.children.classOrInterfaceType[0]) {
                // Sometimes generics are nested here
                const nested = classType.children.classOrInterfaceType[0];
                if (nested.children && nested.children.Identifier && nested.children.Identifier[0]) {
                  superclassName = nested.children.Identifier[0].image || '';
                  console.log('Superclass name (nested):', superclassName);
                } else {
                  console.log('No Identifier found in nested classOrInterfaceType');
                }
              } else {
                console.log('No Identifier found in classType');
              }
            } else {
              console.log('No classType found in classExtends');
            }
          } else {
            console.log('No classExtends found in normalClassDeclaration');
          }
        } else {
          console.log('No normalClassDeclaration found');
        }

        // Check for annotations on the class
        if (n.children && n.children.classModifier) {
          console.log('Class modifiers found:', n.children.classModifier.length);
          for (const modifier of n.children.classModifier) {
            console.log('Modifier:', modifier.name);
            if (modifier.children && modifier.children.annotation) {
              console.log('Annotations in modifier:', modifier.children.annotation.length);
              for (const annotation of modifier.children.annotation) {
                console.log('Annotation:', annotation);

                // Extract annotation name
                let annotationName = '';
                if (annotation.children && annotation.children.typeName && annotation.children.typeName[0]) {
                  const typeNameNode = annotation.children.typeName[0];
                  if (typeNameNode.children && typeNameNode.children.Identifier && typeNameNode.children.Identifier[0]) {
                    annotationName = typeNameNode.children.Identifier[0].image || '';
                  }
                }
                console.log('Annotation name:', annotationName);

                if (annotationName === 'ComponentId') {
                  hasComponentId = true;
                  console.log('Found ComponentId annotation!');
                  // Extract ComponentId value
                  if (annotation.children && annotation.children.elementValue) {
                    const ev = annotation.children.elementValue[0];
                    console.log('Element value node:', ev);
                    console.log('Element value children keys:', Object.keys(ev.children || {}));
                    if (ev.children && ev.children.conditionalExpression && ev.children.conditionalExpression[0]) {
                      const cond = ev.children.conditionalExpression[0];
                      console.log('Conditional expression:', cond);
                      console.log('Conditional expression children keys:', Object.keys(cond.children || {}));
                    }
                    const stringValue = extractStringValueFromElementValue(ev);
                    componentIdValue = stringValue || '';
                    console.log('ComponentId value:', componentIdValue);
                  } else {
                    console.log('No elementValue found in ComponentId annotation');
                  }
                } else if (endpointAnnotations.includes(annotationName)) {
                  endpointType = annotationName;
                  console.log('Found endpoint annotation:', annotationName);
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
                  console.log('Endpoint value:', endpointValue);
                }
              }
            }
          }
        }

        console.log('\n--- Summary ---');
        console.log('hasComponentId:', hasComponentId);
        console.log('componentIdValue:', componentIdValue);
        console.log('superclassName:', superclassName);
        console.log('akkaSuperclasses.includes(superclassName):', akkaSuperclasses.includes(superclassName));
        console.log('endpointType:', endpointType);
        console.log('endpointValue:', endpointValue);

        // Add superclass-based component if it has ComponentId and extends Akka superclass
        if (hasComponentId && componentIdValue && akkaSuperclasses.includes(superclassName)) {
          console.log('✅ Adding superclass-based component');
          components.push({
            filename,
            className,
            componentType: superclassName,
            componentId: componentIdValue,
          });
        }

        // Add endpoint-based component if it has endpoint annotation
        if (endpointType && endpointValue) {
          console.log('✅ Adding endpoint-based component');
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

  // Function to extract string value from element value
  function extractStringValueFromElementValue(ev) {
    if (!ev) return '';

    // Handle conditionalExpression -> binaryExpression -> unaryExpression -> primary -> literal
    if (ev.children && ev.children.conditionalExpression && ev.children.conditionalExpression[0]) {
      const cond = ev.children.conditionalExpression[0];
      if (cond.children && cond.children.binaryExpression && cond.children.binaryExpression[0]) {
        const binary = cond.children.binaryExpression[0];
        // Look for unaryExpression inside binaryExpression
        if (binary.children && binary.children.unaryExpression && binary.children.unaryExpression[0]) {
          const unary = binary.children.unaryExpression[0];
          // Look for primary inside unaryExpression
          if (unary.children && unary.children.primary && unary.children.primary[0]) {
            const primary = unary.children.primary[0];
            console.log('Primary node:', primary);
            console.log('Primary children keys:', Object.keys(primary.children || {}));
            // Look for literal inside primaryPrefix within primary
            if (primary.children && primary.children.primaryPrefix && primary.children.primaryPrefix[0]) {
              const primaryPrefix = primary.children.primaryPrefix[0];
              console.log('PrimaryPrefix node:', primaryPrefix);
              console.log('PrimaryPrefix children keys:', Object.keys(primaryPrefix.children || {}));
              if (primaryPrefix.children && primaryPrefix.children.literal && primaryPrefix.children.literal[0]) {
                const literal = primaryPrefix.children.literal[0];
                console.log('Literal found in primaryPrefix:', literal);
                console.log('Literal children keys:', Object.keys(literal.children || {}));
                if (literal.children && literal.children.StringLiteral && literal.children.StringLiteral[0]) {
                  const stringLiteral = literal.children.StringLiteral[0];
                  const result = stringLiteral.image ? stringLiteral.image.replace(/^"|"$/g, '') : '';
                  console.log('Extracted string value from primaryPrefix:', result);
                  return result;
                }
              }
            }
            // Fallback: Look for literal inside primary
            if (primary.children && primary.children.literal && primary.children.literal[0]) {
              const literal = primary.children.literal[0];
              console.log('Literal found in primary:', literal);
              console.log('Literal children keys:', Object.keys(literal.children || {}));
              if (literal.children && literal.children.StringLiteral && literal.children.StringLiteral[0]) {
                const stringLiteral = literal.children.StringLiteral[0];
                const result = stringLiteral.image ? stringLiteral.image.replace(/^"|"$/g, '') : '';
                console.log('Extracted string value from primary:', result);
                return result;
              }
            }
          }
          // Fallback: Look for literal inside unaryExpression
          if (unary.children && unary.children.literal && unary.children.literal[0]) {
            const literal = unary.children.literal[0];
            if (literal.children && literal.children.StringLiteral && literal.children.StringLiteral[0]) {
              const stringLiteral = literal.children.StringLiteral[0];
              const result = stringLiteral.image ? stringLiteral.image.replace(/^"|"$/g, '') : '';
              return result;
            }
          }
        }
        // Fallback: Look for literal directly inside binaryExpression
        if (binary.children && binary.children.literal && binary.children.literal[0]) {
          const literal = binary.children.literal[0];
          if (literal.children && literal.children.StringLiteral && literal.children.StringLiteral[0]) {
            const stringLiteral = literal.children.StringLiteral[0];
            const result = stringLiteral.image ? stringLiteral.image.replace(/^"|"$/g, '') : '';
            return result;
          }
        }
      }
    }

    // Handle conditionalExpression (common for annotation arguments)
    if (ev.children && ev.children.conditionalExpression && ev.children.conditionalExpression[0]) {
      const cond = ev.children.conditionalExpression[0];
      // Look for literal inside conditionalExpression
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

  const components = extractAkkaComponentsFromCST(cst, testFile);

  console.log('\n' + '='.repeat(50));
  console.log('FINAL RESULTS:');
  console.log('='.repeat(50));
  console.log(`Found ${components.length} components:`);
  components.forEach((comp, index) => {
    console.log(`  ${index + 1}. ${comp.className} (${comp.componentType}) - ID: ${comp.componentId}`);
  });
} catch (error) {
  console.error('Error:', error);
}
