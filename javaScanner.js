const fs = require('fs');
const path = require('path');
const { parse } = require('java-parser');

// Enhanced logger with structured data and levels
const logger = {
  debug: (message, metadata = {}) => 
    console.log(JSON.stringify({timestamp: new Date().toISOString(), level: 'DEBUG', message, ...metadata})),
  info: (message, metadata = {}) => 
    console.log(JSON.stringify({timestamp: new Date().toISOString(), level: 'INFO', message, ...metadata})),
  error: (message, metadata = {}) => 
    console.error(JSON.stringify({timestamp: new Date().toISOString(), level: 'ERROR', message, ...metadata}))
};

function logNodeInfo(node, sourceCode, depth = 0, filePath) {
  const nodeMetadata = {
    nodeType: node.name,
    location: node.location,
    depth,
    file: path.basename(filePath),
    childrenCount: node.children ? Object.keys(node.children).length : 0
  };

  // Extract source code snippet if available
  if (node.location && node.location.startOffset !== undefined && node.location.endOffset !== undefined) {
    nodeMetadata.sourceSnippet = sourceCode.substring(
      node.location.startOffset,
      Math.min(node.location.endOffset + 1, node.location.startOffset + 100)
    );
  }

  logger.debug(`Node name: ${node.name}`, nodeMetadata);

  if (node.children) {
    Object.entries(node.children).forEach(([childType, children]) => {
      children.forEach(child => {
        logNodeInfo(child, sourceCode, depth + 1, filePath);
      });
    });
  }
}

function parseJavaFile(filePath) {
  try {
    const javaCode = fs.readFileSync(filePath, 'utf-8');
    const cst = parse(javaCode);
    
    logger.info(`Started parsing: ${path.basename(filePath)}`, {
      fileSize: javaCode.length,
      nodesCount: Object.keys(cst.children).length
    });
    
    logNodeInfo(cst, javaCode, 0, filePath);
    
    logger.info(`Completed parsing: ${path.basename(filePath)}`, {
      parseStatus: 'SUCCESS'
    });
    
    return cst;
  } catch (error) {
    logger.error(`Parse failed: ${error.message}`, {
      file: path.basename(filePath),
      errorType: error.constructor.name,
      stackTrace: error.stack
    });
    return null;
  }
}

// Command-line execution
if (process.argv.length < 3) {
  logger.error('Usage: node javaScanner.js <path-to-java-file>');
  process.exit(1);
}

parseJavaFile(process.argv[2]);
