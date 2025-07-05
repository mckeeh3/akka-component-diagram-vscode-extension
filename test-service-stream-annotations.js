const { extractComponentConnectionsFromCST } = require('./out/parsers/javaCstUtils');

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

// Mock CST structure for testing ServiceStream consume annotations
const mockConsumeCST = {
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
                            identifier: [{ image: 'CustomersByEmailView' }],
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
                                                                      annotationName: [{ image: 'Consume' }],
                                                                      elementValue: [
                                                                        {
                                                                          children: {
                                                                            elementValuePair: [
                                                                              {
                                                                                children: {
                                                                                  identifier: [{ image: 'FromServiceStream' }],
                                                                                  elementValue: [
                                                                                    {
                                                                                      children: {
                                                                                        elementValuePair: [
                                                                                          {
                                                                                            children: {
                                                                                              identifier: [{ image: 'service' }],
                                                                                              elementValue: [
                                                                                                {
                                                                                                  children: {
                                                                                                    literal: [{ image: '"customer-registry"' }],
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
                                                                startOffset: 200,
                                                                endOffset: 250,
                                                                startLine: 21,
                                                                startColumn: 1,
                                                                endLine: 25,
                                                                endColumn: 5,
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

// Mock source text for Produce.ServiceStream
const mockSourceText1 = `
@Produce.ServiceStream(id = "customer_events")
public class CustomerEvents {
  // class content
}
`;

// Mock source text for Consume.FromServiceStream with service parameter
const mockSourceText2 = `
@Consume.FromServiceStream(
    service = "customer-registry",
    id = "customer_events",
    consumerGroup = "customer-by-email-view"
)
public class CustomersByEmailView {
  // class content
}
`;

console.log('[Test] Testing ServiceStream annotation parsing...');

// Test 1: Produce.ServiceStream with id parameter
console.log('\n[Test] Test 1: Produce.ServiceStream with id parameter');
try {
  const result1 = extractComponentConnectionsFromCST(mockCST, 'CustomerEvents.java', mockSourceText1);

  console.log('[Test] Parsing result:', result1);
  console.log('[Test] Connections found:', result1.connections.length);
  console.log('[Test] ServiceStream nodes found:', result1.serviceStreamNodes.length);

  if (result1.serviceStreamNodes.length > 0) {
    console.log('[Test] ServiceStream nodes:');
    result1.serviceStreamNodes.forEach((stream, index) => {
      console.log(`  ${index + 1}: ${stream.id} (${stream.name}) - ${stream.type}`);
    });
  }

  if (result1.connections.length > 0) {
    console.log('[Test] Connections:');
    result1.connections.forEach((conn, index) => {
      console.log(`  ${index + 1}: ${conn.source} -> ${conn.target} (${conn.label})`);
    });
  }
} catch (error) {
  console.error('[Test] Error testing Produce.ServiceStream annotation parsing:', error);
}

// Test 2: Consume.FromServiceStream with service parameter
console.log('\n[Test] Test 2: Consume.FromServiceStream with service parameter');
try {
  const result2 = extractComponentConnectionsFromCST(mockConsumeCST, 'CustomersByEmailView.java', mockSourceText2);

  console.log('[Test] Parsing result:', result2);
  console.log('[Test] Connections found:', result2.connections.length);
  console.log('[Test] ServiceStream nodes found:', result2.serviceStreamNodes.length);

  if (result2.serviceStreamNodes.length > 0) {
    console.log('[Test] ServiceStream nodes:');
    result2.serviceStreamNodes.forEach((stream, index) => {
      console.log(`  ${index + 1}: ${stream.id} (${stream.name}) - ${stream.type}`);
    });
  }

  if (result2.connections.length > 0) {
    console.log('[Test] Connections:');
    result2.connections.forEach((conn, index) => {
      console.log(`  ${index + 1}: ${conn.source} -> ${conn.target} (${conn.label})`);
    });
  }
} catch (error) {
  console.error('[Test] Error testing Consume.FromServiceStream annotation parsing:', error);
}

console.log('\n[Test] ServiceStream annotation parsing test completed!');
