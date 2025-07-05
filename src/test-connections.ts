import * as fs from 'fs';
import { parse } from 'java-parser';
import { extractComponentConnectionsFromCST } from './parsers/javaCstUtils';
import { createPrefixedLogger } from './utils/logger';

async function testConnectionExtraction() {
  try {
    // For testing, we'll use console.log directly since we don't have a VS Code output channel
    console.log('[Test] === Testing Connection Extraction ===');

    const javaCode = fs.readFileSync('test-samples/shopping-cart-with-view/src/main/java/shoppingcart/api/ShoppingCartEndpoint.java', 'utf8');
    const cst = parse(javaCode);

    const { connections, topicNodes } = extractComponentConnectionsFromCST(cst, 'ShoppingCartEndpoint.java');

    console.log(`[Test] Found ${connections.length} connections:`);
    connections.forEach((conn, index) => {
      console.log(`[Test]   ${index + 1}. ${conn.source} -> ${conn.target} (${conn.label}) via ${conn.details.join(', ')}`);
    });

    console.log(`[Test] Found ${topicNodes.length} topic nodes:`);
    topicNodes.forEach((topic, index) => {
      console.log(`[Test]   ${index + 1}. ${topic.id} (${topic.name}) - ${topic.type}`);
    });
  } catch (error) {
    console.error('Error testing connection extraction:', error);
  }
}

testConnectionExtraction();
