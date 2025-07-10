package com.example;

import com.akkaserverless.javasdk.Agent;
import com.akkaserverless.javasdk.EventSourcedEntity;
import com.akkaserverless.javasdk.FunctionTool;

@ComponentId("test-agent")
public class TestAgent extends Agent {

  private final TestEntity entityClient;
  private final CalculatorTool calculatorTool;

  public TestAgent(TestEntity entityClient, CalculatorTool calculatorTool) {
    this.entityClient = entityClient;
    this.calculatorTool = calculatorTool;
  }

  public void processData() {
    // Reference to TestEntity component
    TestEntity entity = new TestEntity();

    // Method call with component reference
    entityClient.someMethod();

    // Tool usage
    int result = calculatorTool.add(5, 3);
  }
}

@ComponentId("test-entity")
public class TestEntity extends EventSourcedEntity {

  public void someMethod() {
    // This method is called by TestAgent
  }

  public void processWithAgent(TestAgent agent) {
    // Method parameter references TestAgent component
    agent.processData();
  }
}

@FunctionTool("calculator")
public class CalculatorTool {

  public int add(int a, int b) {
    return a + b;
  }

  public int multiply(int a, int b) {
    return a * b;
  }
}