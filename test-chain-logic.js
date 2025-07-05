console.log('[Test] Testing flexible method chain logic...');

// Test the logic for detecting flexible method chains
function testFlexibleChainLogic() {
  // Test case 1: Standard pattern for* -> method -> invoke
  const chain1 = ['forAgent', 'method', 'invoke'];
  const hasForMethod1 = chain1.some((method) => method.startsWith('for') || method === 'forView' || method === 'forEventSourcedEntity');
  const hasMethodCall1 = chain1.includes('method');
  const hasInvokeCall1 = chain1.some((method) => method === 'invoke' || method === 'invokeAsync');

  console.log('[Test] Chain 1:', chain1.join(' -> '));
  console.log('[Test] Has for method:', hasForMethod1);
  console.log('[Test] Has method call:', hasMethodCall1);
  console.log('[Test] Has invoke call:', hasInvokeCall1);
  console.log('[Test] Valid pattern:', hasForMethod1 && hasMethodCall1 && hasInvokeCall1);

  // Test case 2: Flexible pattern with additional methods
  const chain2 = ['forAgent', 'inSession', 'method', 'invoke'];
  const hasForMethod2 = chain2.some((method) => method.startsWith('for') || method === 'forView' || method === 'forEventSourcedEntity');
  const hasMethodCall2 = chain2.includes('method');
  const hasInvokeCall2 = chain2.some((method) => method === 'invoke' || method === 'invokeAsync');

  console.log('[Test] Chain 2:', chain2.join(' -> '));
  console.log('[Test] Has for method:', hasForMethod2);
  console.log('[Test] Has method call:', hasMethodCall2);
  console.log('[Test] Has invoke call:', hasInvokeCall2);
  console.log('[Test] Valid pattern:', hasForMethod2 && hasMethodCall2 && hasInvokeCall2);

  // Test case 3: Invalid pattern (missing method)
  const chain3 = ['forAgent', 'inSession', 'invoke'];
  const hasForMethod3 = chain3.some((method) => method.startsWith('for') || method === 'forView' || method === 'forEventSourcedEntity');
  const hasMethodCall3 = chain3.includes('method');
  const hasInvokeCall3 = chain3.some((method) => method === 'invoke' || method === 'invokeAsync');

  console.log('[Test] Chain 3:', chain3.join(' -> '));
  console.log('[Test] Has for method:', hasForMethod3);
  console.log('[Test] Has method call:', hasMethodCall3);
  console.log('[Test] Has invoke call:', hasInvokeCall3);
  console.log('[Test] Valid pattern:', hasForMethod3 && hasMethodCall3 && hasInvokeCall3);

  // Test case 4: Another flexible pattern
  const chain4 = ['forEventSourcedEntity', 'withId', 'method', 'invokeAsync'];
  const hasForMethod4 = chain4.some((method) => method.startsWith('for') || method === 'forView' || method === 'forEventSourcedEntity');
  const hasMethodCall4 = chain4.includes('method');
  const hasInvokeCall4 = chain4.some((method) => method === 'invoke' || method === 'invokeAsync');

  console.log('[Test] Chain 4:', chain4.join(' -> '));
  console.log('[Test] Has for method:', hasForMethod4);
  console.log('[Test] Has method call:', hasMethodCall4);
  console.log('[Test] Has invoke call:', hasInvokeCall4);
  console.log('[Test] Valid pattern:', hasForMethod4 && hasMethodCall4 && hasInvokeCall4);
}

testFlexibleChainLogic();
console.log('[Test] Flexible method chain logic test completed!');
