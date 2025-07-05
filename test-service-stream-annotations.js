const { extractComponentConnectionsFromCST } = require('./out/src/parsers/javaCstUtils');

// Mock CST structure for testing ServiceStream annotations
const mockCST = {
  children: {
    ordinaryCompilationUnit: [
      {
        children: {
          typeDeclaration: [
            {
              children: {
                classDeclaration: [
                  {
                    children: {
                      normalClassDeclaration: [
                        {
                          children: {
                            identifier: [{ image: 'CustomerEvents' }],
                            classBody: [
                              {
                                children: {
                                  classBodyDeclaration: [
                                    {
                                      children: {
                                        classMemberDeclaration: [
                                          {
                                            children: {
                                              fieldDeclaration: [
                                                {
                                                  children: {
                                                    fieldModifier: [
                                                      {
                                                        children: {
                                                          annotation: [
                                                            {
                                                              children: {
                                                                singleElementAnnotation: [
                                                                  {
                                                                    children: {
                                                                      annotationName: [{ image: 'Produce' }],
                                                                      elementValue: [
                                                                        {
                                                                          children: {
                                                                            elementValuePair: [
                                                                              {
                                                                                children: {
                                                                                  identifier: [{ image: 'ServiceStream' }],
                                                                                  elementValue: [
                                                                                    {
                                                                                      children: {
                                                                                        elementValuePair: [
                                                                                          {
                                                                                            children: {
                                                                                              identifier: [{ image: 'id' }],
                                                                                              elementValue: [
                                                                                                {
                                                                                                  children: {
                                                                                                    literal: [{ image: '"customer_events"' }],
                                                                                                  },
                                                                                                },
                                                                                              ],
                                                                                            },
                                                                                          },
                                                                                        ],
                                                                                      },
                                                                                    },
                                                                                  ],
                                                                                },
                                                                              },
                                                                            ],
                                                                          },
                                                                        },
                                                                      ],
                                                                    },
                                                                  },
                                                                ],
                                                              },
                                                              location: {
                                                                startOffset: 100,
                                                                endOffset: 150,
                                                                startLine: 17,
                                                                startColumn: 1,
                                                                endLine: 17,
                                                                endColumn: 50,
                                                              },
                                                            },
                                                          ],
                                                        },
                                                      },
                                                    ],
                                                  },
                                                },
                                              ],
                                            },
                                          },
                                        ],
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  },
};

// Mock source text
const mockSourceText = `
@Produce.ServiceStream(id = "customer_events")
public class CustomerEvents {
  // class content
}
`;

console.log('[Test] Testing ServiceStream annotation parsing...');

try {
  const result = extractComponentConnectionsFromCST(mockCST, 'CustomerEvents.java', mockSourceText);

  console.log('[Test] Parsing result:', result);
  console.log('[Test] Connections found:', result.connections.length);
  console.log('[Test] ServiceStream nodes found:', result.serviceStreamNodes.length);

  if (result.serviceStreamNodes.length > 0) {
    console.log('[Test] ServiceStream nodes:');
    result.serviceStreamNodes.forEach((stream, index) => {
      console.log(`  ${index + 1}: ${stream.id} (${stream.name}) - ${stream.type}`);
    });
  }

  if (result.connections.length > 0) {
    console.log('[Test] Connections:');
    result.connections.forEach((conn, index) => {
      console.log(`  ${index + 1}: ${conn.source} -> ${conn.target} (${conn.label})`);
    });
  }

  console.log('[Test] ServiceStream annotation parsing test completed successfully!');
} catch (error) {
  console.error('[Test] Error testing ServiceStream annotation parsing:', error);
}
