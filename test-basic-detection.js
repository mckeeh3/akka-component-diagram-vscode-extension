const { JavaParser } = require('./out/parsers/javaParser');

// Test Java code with various Akka components
const testJavaCode = `
package com.example;

import com.akkaserverless.javasdk.Agent;
import com.akkaserverless.javasdk.EventSourcedEntity;
import com.akkaserverless.javasdk.KeyValueEntity;
import com.akkaserverless.javasdk.View;
import com.akkaserverless.javasdk.Consumer;
import com.akkaserverless.javasdk.Workflow;
import com.akkaserverless.javasdk.TimedAction;
import com.akkaserverless.javasdk.HttpEndpoint;
import com.akkaserverless.javasdk.GrpcEndpoint;

@ComponentId("my-agent")
public class MyAgent extends Agent {
    // Agent implementation
}

@ComponentId("my-entity")
public class MyEntity extends EventSourcedEntity {
    // Entity implementation
}

@ComponentId("my-key-value")
public class MyKeyValue extends KeyValueEntity {
    // KeyValue implementation
}

@ComponentId("my-view")
public class MyView extends View {
    // View implementation
}

@ComponentId("my-consumer")
public class MyConsumer extends Consumer {
    // Consumer implementation
}

@ComponentId("my-workflow")
public class MyWorkflow extends Workflow {
    // Workflow implementation
}

@ComponentId("my-timer")
public class MyTimer extends TimedAction {
    // Timer implementation
}

@HttpEndpoint(name = "my-http-endpoint")
public class MyHttpEndpoint {
    // HTTP endpoint implementation
}

@GrpcEndpoint(name = "my-grpc-endpoint")
public class MyGrpcEndpoint {
    // gRPC endpoint implementation
}
`;

console.log('Testing basic component detection...');

try {
  const cst = JavaParser.parse(testJavaCode);
  const components = JavaParser.extractAkkaComponentsFromCST(cst, 'test.java');

  console.log('Detected components:');
  components.forEach((comp) => {
    console.log(`- ${comp.className} (${comp.componentType}): ${comp.componentId}`);
  });

  console.log(`\nTotal components detected: ${components.length}`);

  if (components.length === 8) {
    console.log('✅ All expected components detected!');
  } else {
    console.log('❌ Expected 8 components, but found', components.length);
  }
} catch (error) {
  console.error('Error during testing:', error);
}
