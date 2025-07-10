const { parse } = require('java-parser');

// Test Java code with VisualizerAgent and function tools
const testJavaCode = `
package com.example;

import com.lightbend.akka.sample.agent.VisualizerAgent;
import com.lightbend.akka.sample.agent.tools.DataAnalysisTool;
import com.lightbend.akka.sample.agent.tools.ReportGeneratorTool;
import com.lightbend.akka.sample.agent.tools.ChartCreationTool;

@FunctionTool
public class DataAnalysisTool {
    public String analyzeData(String data) {
        return "Analysis result";
    }
}

@FunctionTool
public class ReportGeneratorTool {
    public String generateReport(String analysis) {
        return "Report";
    }
}

@FunctionTool
public class ChartCreationTool {
    public String createChart(String data) {
        return "Chart";
    }
}

public class VisualizerAgent {
    private final ComponentClient componentClient;
    
    public VisualizerAgent(ComponentClient componentClient) {
        this.componentClient = componentClient;
    }
    
    public void processData() {
        // This should create edges to the function tools
        componentClient.tools(List.of(
            new DataAnalysisTool(),
            new ReportGeneratorTool(),
            new ChartCreationTool()
        ));
    }
}
`;

console.log('Testing component reference detection logic...');
console.log('========================================');

try {
  const cst = parse(testJavaCode);
  console.log('[DEBUG] Top-level CST keys:', Object.keys(cst));

  // Simulate the component reference detection logic
  const allComponentsForReference = [
    { className: 'DataAnalysisTool', componentType: 'FunctionTool' },
    { className: 'ReportGeneratorTool', componentType: 'FunctionTool' },
    { className: 'ChartCreationTool', componentType: 'FunctionTool' },
    { className: 'VisualizerAgent', componentType: 'Agent' },
  ];

  console.log(`\n=== TESTING COMPONENT REFERENCE SCAN ===`);
  console.log('Components available for reference detection:');
  allComponentsForReference.forEach((comp, index) => {
    console.log(`  ${index + 1}. ${comp.className} (${comp.componentType})`);
  });

  // Simple scan for component references
  const componentClassNames = allComponentsForReference.map((comp) => comp.className);
  let referenceCount = 0;

  function scanForReferences(node, className) {
    if (!node || typeof node !== 'object') return;

    // Check if this node has an image that matches a component class name
    if (node.image) {
      const referencedClassName = node.image;
      if (componentClassNames.includes(referencedClassName) && referencedClassName !== className) {
        console.log(`[Component Reference Detection] Found reference to component: ${referencedClassName} in ${className}`);
        referenceCount++;
      }
    }

    // Recurse into children
    if (node.children) {
      for (const [key, children] of Object.entries(node.children)) {
        if (Array.isArray(children)) {
          for (const child of children) {
            if (child && typeof child === 'object') {
              scanForReferences(child, className);
            }
          }
        } else if (children && typeof children === 'object') {
          scanForReferences(children, className);
        }
      }
    }
  }

  // Scan each class for references
  if (cst.children && cst.children.ordinaryCompilationUnit && cst.children.ordinaryCompilationUnit[0].children.typeDeclaration) {
    cst.children.ordinaryCompilationUnit[0].children.typeDeclaration.forEach((typeDecl) => {
      if (typeDecl.children && typeDecl.children.classDeclaration && typeDecl.children.classDeclaration[0].children.normalClassDeclaration) {
        const classDecl = typeDecl.children.classDeclaration[0];
        const normalClass = classDecl.children.normalClassDeclaration[0];

        // Extract class name more safely
        let className = null;
        if (normalClass.children && normalClass.children.typeIdentifier) {
          const typeId = normalClass.children.typeIdentifier[0];
          if (typeId.image) {
            className = typeId.image;
          } else if (typeId.children && typeId.children.Identifier) {
            className = typeId.children.Identifier[0].image;
          }
        }

        if (className) {
          console.log(`\nScanning class: ${className}`);
          scanForReferences(cst, className);
        } else {
          console.log(`\nCould not extract class name from CST structure`);
          console.log('Normal class children keys:', Object.keys(normalClass.children || {}));
        }
      }
    });
  }

  console.log(`\n=== FINAL RESULTS ===`);
  console.log(`Total references found: ${referenceCount}`);
} catch (error) {
  console.error('Error:', error);
}
