const fs = require('fs');
const path = require('path');
const javaParser = require('java-parser');

// Note: We're using the inline functions instead of importing from TypeScript

// Function to recursively find all Java files
function findJavaFiles(dir, files = []) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      findJavaFiles(fullPath, files);
    } else if (item.endsWith('.java')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Function to extract Akka component information from CST
function extractAkkaComponentsFromCST(node, filename) {
  const components = [];
  const akkaSuperclasses = ['Agent', 'EventSourcedEntity', 'KeyValueEntity', 'View', 'Consumer', 'Workflow', 'TimedAction'];
  const endpointAnnotations = ['HttpEndpoint', 'GrpcEndpoint', 'MCPEndpoint'];

  function extractStringValueFromElementValue(ev) {
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

  function recurse(n) {
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
                  const namePair = pairs.find((pair) => pair.children && pair.children.Identifier && pair.children.Identifier[0] && pair.children.Identifier[0].image === 'name');
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

// Main test function
async function testAllSamples() {
  console.log('=== Akka Sample Projects Component Extraction Test ===\n');

  const testSamplesDir = path.join(__dirname, 'test-samples');
  const projectDirs = fs
    .readdirSync(testSamplesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  console.log(`Found ${projectDirs.length} sample projects:\n`);
  projectDirs.forEach((dir, index) => {
    console.log(`  ${index + 1}. ${dir}`);
  });
  console.log('');

  let totalComponents = 0;
  let totalFiles = 0;
  const allComponents = [];

  for (const projectDir of projectDirs) {
    console.log(`\n--- Testing Project: ${projectDir} ---`);

    const projectPath = path.join(testSamplesDir, projectDir);
    const javaSourcePath = path.join(projectPath, 'src', 'main', 'java');

    if (!fs.existsSync(javaSourcePath)) {
      console.log(`  ⚠️  No Java source directory found at: ${javaSourcePath}`);
      continue;
    }

    const javaFiles = findJavaFiles(javaSourcePath);
    console.log(`  📁 Found ${javaFiles.length} Java files`);

    if (javaFiles.length === 0) {
      console.log(`  ⚠️  No Java files found in: ${javaSourcePath}`);
      continue;
    }

    let projectComponents = 0;

    for (const javaFile of javaFiles) {
      try {
        const content = fs.readFileSync(javaFile, 'utf8');
        const cst = javaParser.parse(content);

        const components = extractAkkaComponentsFromCST(cst, path.relative(process.cwd(), javaFile));

        if (components.length > 0) {
          console.log(`  ✅ ${path.basename(javaFile)}: ${components.length} component(s)`);
          components.forEach((comp) => {
            console.log(`     - ${comp.className} (${comp.componentType}) - ID: ${comp.componentId}`);
            allComponents.push({
              project: projectDir,
              ...comp,
            });
          });
          projectComponents += components.length;
        } else {
          console.log(`  ⚪ ${path.basename(javaFile)}: No Akka components found`);
        }

        totalFiles++;
      } catch (error) {
        console.log(`  ❌ ${path.basename(javaFile)}: Parse error - ${error.message}`);
      }
    }

    console.log(`  📊 Project total: ${projectComponents} components`);
    totalComponents += projectComponents;
  }

  // Summary report
  console.log('\n' + '='.repeat(60));
  console.log('📋 SUMMARY REPORT');
  console.log('='.repeat(60));
  console.log(`Total projects scanned: ${projectDirs.length}`);
  console.log(`Total Java files processed: ${totalFiles}`);
  console.log(`Total Akka components found: ${totalComponents}`);

  if (allComponents.length > 0) {
    console.log('\n📊 COMPONENT BREAKDOWN BY TYPE:');
    const typeCount = {};
    allComponents.forEach((comp) => {
      typeCount[comp.componentType] = (typeCount[comp.componentType] || 0) + 1;
    });

    Object.entries(typeCount)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

    console.log('\n📋 ALL COMPONENTS:');
    allComponents.forEach((comp, index) => {
      console.log(`  ${index + 1}. [${comp.project}] ${comp.className} (${comp.componentType}) - ID: ${comp.componentId}`);
    });
  }

  console.log('\n✅ Test completed successfully!');
}

// Run the test
testAllSamples().catch(console.error);
