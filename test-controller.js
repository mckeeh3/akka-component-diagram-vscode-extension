const { ComponentDiagramController } = require('./src/parsers/componentDiagramController');

async function testController() {
  console.log('Testing ComponentDiagramController...');

  // Mock VSCode URI objects
  const javaFiles = [{ fsPath: '/path/to/file1.java' }, { fsPath: '/path/to/file2.java' }];

  // Mock output channel
  const outputChannel = {
    appendLine: (message) => console.log(`[Output] ${message}`),
  };

  const controller = new ComponentDiagramController(outputChannel);

  try {
    const result = await controller.processProject(javaFiles);
    console.log('Controller result:', result);
    console.log(`Nodes: ${result.nodes.length}, Edges: ${result.edges.length}`);
  } catch (error) {
    console.error('Controller error:', error);
  }
}

testController();
