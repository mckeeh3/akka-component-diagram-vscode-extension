import * as fs from 'fs';
import { parse } from 'java-parser';
import { extractComponentConnectionsFromCST } from './parsers/javaCstUtils';

async function testConnectionExtraction() {
  try {
    console.log('=== Testing Connection Extraction ===');

    const javaCode = fs.readFileSync('test-samples/shopping-cart-with-view/src/main/java/shoppingcart/api/ShoppingCartEndpoint.java', 'utf8');
    const cst = parse(javaCode);

    const connections = extractComponentConnectionsFromCST(cst, 'ShoppingCartEndpoint.java');

    console.log(`Found ${connections.length} connections:`);
    connections.forEach((conn, index) => {
      console.log(`  ${index + 1}. ${conn.source} -> ${conn.target} (${conn.label}) via ${conn.details.join(', ')}`);
    });
  } catch (error) {
    console.error('Error testing connection extraction:', error);
  }
}

testConnectionExtraction();
