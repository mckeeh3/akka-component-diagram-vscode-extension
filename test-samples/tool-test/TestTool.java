package com.example;

import com.akkaserverless.javasdk.Agent;
import com.akkaserverless.javasdk.FunctionTool;

@ComponentId("test-agent")
public class TestAgent extends Agent {
  // Test agent implementation
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

@FunctionTool
public class SimpleTool {
  public String process(String input) {
    return input.toUpperCase();
  }
}

@FunctionTool(name = "custom-tool")
public class CustomTool {
  public void doSomething() {
    // Tool implementation
  }
}