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

console.log('Testing modular approach for component detection...');
console.log('========================================');

try {
    const cst = parse(testJavaCode);
    console.log('[DEBUG] Top-level CST keys:', Object.keys(cst));
    
    // Step 1: Simulate Akka component detection
    console.log('\n=== STEP 1: AKKA COMPONENT DETECTION ===');
    const akkaComponents = [
        { className: 'VisualizerAgent', componentType: 'Agent', filename: 'test.java' }
    ];
    console.log(`Detected ${akkaComponents.length} Akka components:`);
    akkaComponents.forEach((comp, index) => {
        console.log(`  ${index + 1}. ${comp.className} (${comp.componentType})`);
    });
    
    // Step 2: Function tool class detection
    console.log('\n=== STEP 2: FUNCTION TOOL CLASS DETECTION ===');
    const functionToolClasses = [
        { className: 'DataAnalysisTool', componentType: 'FunctionTool', filename: 'test.java' },
        { className: 'ReportGeneratorTool', componentType: 'FunctionTool', filename: 'test.java' },
        { className: 'ChartCreationTool', componentType: 'FunctionTool', filename: 'test.java' }
    ];
    console.log(`Detected ${functionToolClasses.length} function tool classes:`);
    functionToolClasses.forEach((toolClass, index) => {
        console.log(`  ${index + 1}. ${toolClass.className} (${toolClass.componentType})`);
    });
    
    // Step 3: Combine component lists
    console.log('\n=== STEP 3: COMBINING COMPONENT LISTS ===');
    const allComponentsForReference = [...akkaComponents.map(comp => ({
        className: comp.className,
        componentType: comp.componentType
    }))];
    
    // Add function tool classes that aren't already in the list
    functionToolClasses.forEach((toolClass) => {
        if (!allComponentsForReference.find(c => c.className === toolClass.className)) {
            allComponentsForReference.push({
                className: toolClass.className,
                componentType: toolClass.componentType,
            });
            console.log(`Added function tool class to component list: ${toolClass.className}`);
        } else {
            console.log(`Function tool class already in component list: ${toolClass.className}`);
        }
    });
    
    console.log(`Final component list has ${allComponentsForReference.length} components:`);
    allComponentsForReference.forEach((comp, index) => {
        console.log(`  Component ${index + 1}: ${comp.className} (${comp.componentType})`);
    });
    
    // Step 4: Edge detection with complete component list
    console.log('\n=== STEP 4: EDGE DETECTION WITH COMPLETE COMPONENT LIST ===');
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
                }
            });
        });
    }
    
    console.log(`\n=== FINAL RESULTS ===`);
    console.log(`Total references found: ${referenceCount}`);
    
    // Check specifically for VisualizerAgent -> function tool references
    const expectedReferences = [
        'VisualizerAgent -> DataAnalysisTool',
        'VisualizerAgent -> ReportGeneratorTool', 
        'VisualizerAgent -> ChartCreationTool'
    ];
    
    console.log('\nExpected references:');
    expectedReferences.forEach(ref => {
        console.log(`  - ${ref}`);
    });
    
} catch (error) {
    console.error('Error:', error);
} 