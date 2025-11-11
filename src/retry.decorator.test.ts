import { BackOffPolicy, MaxAttemptsError, Retryable, withRetry, AbortError } from './retry.decorator';

class TestClass {
  count: number;
  constructor() {
    this.count = 0;
  }
  @Retryable({ maxAttempts: 2 })
  async testMethod(): Promise<void> {
    console.log(`test method is called for ${++this.count} time`);
    await this.called();
  }

  @Retryable({ maxAttempts: 2, value: [SyntaxError, ReferenceError] })
  async testMethodWithException(): Promise<void> {
    console.log(`test method is called for ${++this.count} time`);
    await this.called();
  }

  @Retryable({
    maxAttempts: 3,
    doRetry: (e: Error) => {
      return e.message === 'Error: 429';
    },
  })
  async testDoRetry(): Promise<void> {
    console.info(`Calling doRetry for the ${++this.count} time at ${new Date().toLocaleTimeString()}`);
    await this.called();
  }

  @Retryable({
    maxAttempts: 3,
    backOffPolicy: BackOffPolicy.FixedBackOffPolicy,
    backOff: 1000,
  })
  async fixedBackOffRetry(): Promise<void> {
    console.info(`Calling fixedBackOffRetry 1s for the ${++this.count} time at ${new Date().toLocaleTimeString()}`);
    await this.called();
  }

  @Retryable({
    maxAttempts: 3,
    backOffPolicy: BackOffPolicy.ExponentialBackOffPolicy,
    exponentialOption: { maxInterval: 4000, multiplier: 3 },
  })
  async exponentialBackOffRetry(): Promise<void> {
    console.info(`Calling ExponentialBackOffRetry backOff 1s, multiplier=3 for the ${++this.count} time at ${new Date().toLocaleTimeString()}`);
    await this.called();
  }

  @Retryable({
    maxAttempts: 1,
    reraise: true,
  })
  async reraiseError(): Promise<void> {
    console.info(`Calling ExponentialBackOffRetry backOff 1s, multiplier=3 for the ${++this.count} time at ${new Date().toLocaleTimeString()}`);
    await this.called();
  }

  async called(): Promise<string> {
    return 'from real implementation';
  }
}


describe('Retry Test', () => {
  let testClass: TestClass;
  beforeEach(() => {
    testClass = new TestClass();
  });

  test('normal retry', async () => {
    const calledSpy = jest.spyOn(testClass, 'called');
    calledSpy.mockRejectedValueOnce(new Error('rejected'));
    calledSpy.mockResolvedValueOnce('fulfilled');
    await testClass.testMethod();
    expect(calledSpy).toHaveBeenCalledTimes(2);
  });

  test('exceed max retry', async () => {
    const calledSpy = jest.spyOn(testClass, 'called');
    const errorMsg = 'rejected';
    calledSpy.mockRejectedValue(new Error(errorMsg));
    try {
      await testClass.testMethod();
    } catch (e) {
      expect(e).not.toBeUndefined();
      expect(e.message.includes(errorMsg));
    }
    expect(calledSpy).toHaveBeenCalledTimes(3);
  });

  test('retry with specific error', async () => {
    const calledSpy = jest.spyOn(testClass, 'called');
    calledSpy.mockImplementationOnce(() => { throw new SyntaxError('I failed!'); });
    await testClass.testMethodWithException();
    expect(calledSpy).toHaveBeenCalledTimes(2);
  });

  test('retry with specific error not match', async () => {
    const calledSpy = jest.spyOn(testClass, 'called');
    calledSpy.mockImplementationOnce(() => { throw new Error('I failed!'); });
    try {
      await testClass.testMethodWithException();
    } catch (e) {}
    expect(calledSpy).toHaveBeenCalledTimes(1);
  });


  test('do retry when high order function retry true', async () => {
    const calledSpy = jest.spyOn(testClass, 'called');
    calledSpy.mockImplementationOnce(() => { throw new Error('Error: 429'); });
    await testClass.testDoRetry();
    expect(calledSpy).toHaveBeenCalledTimes(2);
  });

  test('do NOT retry when high order function retry false', async () => {
    const calledSpy = jest.spyOn(testClass, 'called');
    calledSpy.mockImplementationOnce(() => { throw new Error('Error: 500'); });
    try {
      await testClass.testDoRetry();
    } catch (e) {}
    expect(calledSpy).toHaveBeenCalledTimes(1);
  });

  test('fix backOff policy', async () => {
    const calledSpy = jest.spyOn(testClass, 'called');
    calledSpy.mockImplementation(() => { throw new Error('Error: 500'); });
    try {
      await testClass.fixedBackOffRetry();
    } catch (e) {}
    expect(calledSpy).toHaveBeenCalledTimes(4);
  });

  test('exponential backOff policy', async () => {
    jest.setTimeout(60000);
    const calledSpy = jest.spyOn(testClass, 'called');
    calledSpy.mockImplementation(() => { throw new Error(); });
    try {
      await testClass.exponentialBackOffRetry();
    } catch (e) {}
    expect(calledSpy).toHaveBeenCalledTimes(4);
  });

  class CustomError extends Error {
    code = '999';
    constructor(message: string) {
      super(message);
      Object.setPrototypeOf(this, CustomError.prototype);
    }
  }

  test('original error is contained inside MaxAttemptsError', async () => {
    jest.setTimeout(60000);
    const calledSpy = jest.spyOn(testClass, 'called');
    calledSpy.mockImplementation(() => { throw new CustomError("test-error"); });
    try {
      await testClass.testMethod();
    } catch (e) {
      expect(e).toBeInstanceOf(MaxAttemptsError);
      expect(e.originalError).toBeInstanceOf(CustomError);
      expect(e.originalError.message).toBe("test-error");
    }
  });

  test('reraise will rethrow original Error', async () => {
    jest.setTimeout(60000);
    const calledSpy = jest.spyOn(testClass, 'called');
    calledSpy.mockImplementation(() => { throw new CustomError("test-error"); });
    try {
      await testClass.reraiseError();
    } catch (e) {
      expect(e).toBeInstanceOf(CustomError);
      expect(e.message).toBe("test-error");
    }
  });
});

describe('withRetry Function Wrapper Test', () => {
  let callCount: number;
  let mockImplementation: jest.Mock;

  beforeEach(() => {
    callCount = 0;
    mockImplementation = jest.fn();
  });

  test('normal retry with function wrapper', async () => {
    const asyncFunction = jest.fn()
      .mockRejectedValueOnce(new Error('rejected'))
      .mockResolvedValueOnce('fulfilled');
    
    const wrappedFunction = withRetry({ maxAttempts: 2 }, asyncFunction);
    const result = await wrappedFunction();
    
    expect(asyncFunction).toHaveBeenCalledTimes(2);
    expect(result).toBe('fulfilled');
  });

  test('exceed max retry with function wrapper', async () => {
    const errorMsg = 'rejected';
    const asyncFunction = jest.fn()
      .mockRejectedValue(new Error(errorMsg));
    
    const wrappedFunction = withRetry({ maxAttempts: 2 }, asyncFunction);
    
    try {
      await wrappedFunction();
    } catch (e) {
      expect(e).not.toBeUndefined();
      expect(e.message.includes(errorMsg)).toBeTruthy();
    }
    expect(asyncFunction).toHaveBeenCalledTimes(3);
  });

  test('retry with specific error types', async () => {
    const asyncFunction = jest.fn()
      .mockImplementationOnce(() => { throw new SyntaxError('I failed!'); })
      .mockResolvedValueOnce('success');
    
    const wrappedFunction = withRetry({ 
      maxAttempts: 2, 
      value: [SyntaxError, ReferenceError] 
    }, asyncFunction);
    
    await wrappedFunction();
    expect(asyncFunction).toHaveBeenCalledTimes(2);
  });

  test('retry with specific error not match', async () => {
    const asyncFunction = jest.fn()
      .mockImplementationOnce(() => { throw new Error('I failed!'); });
    
    const wrappedFunction = withRetry({ 
      maxAttempts: 2, 
      value: [SyntaxError, ReferenceError] 
    }, asyncFunction);
    
    try {
      await wrappedFunction();
    } catch (e) {}
    expect(asyncFunction).toHaveBeenCalledTimes(1);
  });

  test('do retry when high order function returns true', async () => {
    const asyncFunction = jest.fn()
      .mockImplementationOnce(() => { throw new Error('Error: 429'); })
      .mockResolvedValueOnce('success');
    
    const wrappedFunction = withRetry({
      maxAttempts: 3,
      doRetry: (e: Error) => {
        return e.message === 'Error: 429';
      },
    }, asyncFunction);
    
    await wrappedFunction();
    expect(asyncFunction).toHaveBeenCalledTimes(2);
  });

  test('do NOT retry when high order function returns false', async () => {
    const asyncFunction = jest.fn()
      .mockImplementationOnce(() => { throw new Error('Error: 500'); });
    
    const wrappedFunction = withRetry({
      maxAttempts: 3,
      doRetry: (e: Error) => {
        return e.message === 'Error: 429';
      },
    }, asyncFunction);
    
    try {
      await wrappedFunction();
    } catch (e) {}
    expect(asyncFunction).toHaveBeenCalledTimes(1);
  });

  test('fixed backOff policy with function wrapper', async () => {
    const asyncFunction = jest.fn()
      .mockImplementation(() => { throw new Error('Error: 500'); });
    
    const wrappedFunction = withRetry({
      maxAttempts: 3,
      backOffPolicy: BackOffPolicy.FixedBackOffPolicy,
      backOff: 1000,
    }, asyncFunction);
    
    try {
      await wrappedFunction();
    } catch (e) {}
    expect(asyncFunction).toHaveBeenCalledTimes(4);
  });

  test('exponential backOff policy with function wrapper', async () => {
    jest.setTimeout(60000);
    const asyncFunction = jest.fn()
      .mockImplementation(() => { throw new Error(); });
    
    const wrappedFunction = withRetry({
      maxAttempts: 3,
      backOffPolicy: BackOffPolicy.ExponentialBackOffPolicy,
      exponentialOption: { maxInterval: 4000, multiplier: 3 },
    }, asyncFunction);
    
    try {
      await wrappedFunction();
    } catch (e) {}
    expect(asyncFunction).toHaveBeenCalledTimes(4);
  });

  class CustomError extends Error {
    code = '999';
    constructor(message: string) {
      super(message);
      Object.setPrototypeOf(this, CustomError.prototype);
    }
  }

  test('original error is contained inside MaxAttemptsError with function wrapper', async () => {
    const asyncFunction = jest.fn()
      .mockImplementation(() => { throw new CustomError("test-error"); });
    
    const wrappedFunction = withRetry({ maxAttempts: 2 }, asyncFunction);
    
    try {
      await wrappedFunction();
    } catch (e) {
      expect(e).toBeInstanceOf(MaxAttemptsError);
      expect(e.originalError).toBeInstanceOf(CustomError);
      expect(e.originalError.message).toBe("test-error");
    }
  });

  test('reraise will rethrow original Error with function wrapper', async () => {
    const asyncFunction = jest.fn()
      .mockImplementation(() => { throw new CustomError("test-error"); });
    
    const wrappedFunction = withRetry({
      maxAttempts: 1,
      reraise: true,
    }, asyncFunction);
    
    try {
      await wrappedFunction();
    } catch (e) {
      expect(e).toBeInstanceOf(CustomError);
      expect(e.message).toBe("test-error");
    }
  });

  test('function wrapper preserves function arguments', async () => {
    const asyncFunction = jest.fn()
      .mockResolvedValue('result');
    
    const wrappedFunction = withRetry({ maxAttempts: 2 }, asyncFunction);
    
    await wrappedFunction('arg1', 'arg2', 123);
    expect(asyncFunction).toHaveBeenCalledWith('arg1', 'arg2', 123);
  });

  test('function wrapper preserves this context', async () => {
    const obj = {
      value: 42,
      asyncMethod: jest.fn(async function(this: any) {
        return this.value;
      })
    };
    
    const wrappedFunction = withRetry({ maxAttempts: 2 }, obj.asyncMethod);
    const result = await wrappedFunction.call(obj);
    
    expect(result).toBe(42);
  });

  test('function wrapper works with synchronous functions', async () => {
    let callCount = 0;
    const syncFunction = () => {
      callCount++;
      if (callCount < 2) {
        throw new Error('Failed');
      }
      return 'success';
    };
    
    const wrappedFunction = withRetry({ maxAttempts: 2 }, syncFunction);
    const result = await wrappedFunction();
    
    expect(result).toBe('success');
    expect(callCount).toBe(2);
  });
});

describe('AbortSignal Support Test', () => {
  test('abort signal stops retry before first attempt', async () => {
    const controller = new AbortController();
    controller.abort(); // Abort immediately
    
    const asyncFunction = jest.fn()
      .mockRejectedValue(new Error('Should not be called'));
    
    const wrappedFunction = withRetry({ 
      maxAttempts: 3,
      signal: controller.signal 
    }, asyncFunction);
    
    try {
      await wrappedFunction();
      fail('Should have thrown AbortError');
    } catch (e) {
      expect(e).toBeInstanceOf(AbortError);
      expect(e.message).toBe('Retry operation aborted');
    }
    expect(asyncFunction).not.toHaveBeenCalled();
  });

  test('abort signal stops retry after first failure', async () => {
    const controller = new AbortController();
    
    const asyncFunction = jest.fn()
      .mockImplementationOnce(() => {
        controller.abort(); // Abort after first attempt
        throw new Error('First attempt failed');
      });
    
    const wrappedFunction = withRetry({ 
      maxAttempts: 3,
      backOff: 1000,
      signal: controller.signal 
    }, asyncFunction);
    
    try {
      await wrappedFunction();
      fail('Should have thrown AbortError');
    } catch (e) {
      expect(e).toBeInstanceOf(AbortError);
    }
    expect(asyncFunction).toHaveBeenCalledTimes(1);
  });

  test('abort signal during backoff sleep', async () => {
    const controller = new AbortController();
    
    const asyncFunction = jest.fn()
      .mockRejectedValue(new Error('Failed'));
    
    const wrappedFunction = withRetry({ 
      maxAttempts: 5,
      backOff: 5000, // Long backoff
      signal: controller.signal 
    }, asyncFunction);
    
    // Abort after 100ms (during sleep)
    setTimeout(() => controller.abort(), 100);
    
    const startTime = Date.now();
    try {
      await wrappedFunction();
      fail('Should have thrown AbortError');
    } catch (e) {
      expect(e).toBeInstanceOf(AbortError);
      const elapsed = Date.now() - startTime;
      // Should abort quickly, not wait for full 5s backoff
      expect(elapsed).toBeLessThan(1000);
    }
    expect(asyncFunction).toHaveBeenCalledTimes(1);
  });

  test('abort signal with exponential backoff', async () => {
    const controller = new AbortController();
    
    let callCount = 0;
    const asyncFunction = jest.fn()
      .mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          controller.abort();
        }
        throw new Error('Failed');
      });
    
    const wrappedFunction = withRetry({ 
      maxAttempts: 5,
      backOffPolicy: BackOffPolicy.ExponentialBackOffPolicy,
      backOff: 1000,
      signal: controller.signal 
    }, asyncFunction);
    
    try {
      await wrappedFunction();
      fail('Should have thrown AbortError');
    } catch (e) {
      expect(e).toBeInstanceOf(AbortError);
    }
    expect(asyncFunction).toHaveBeenCalledTimes(2);
  });

  test('successful retry completes before abort signal', async () => {
    const controller = new AbortController();
    
    const asyncFunction = jest.fn()
      .mockRejectedValueOnce(new Error('First attempt failed'))
      .mockResolvedValueOnce('success');
    
    const wrappedFunction = withRetry({ 
      maxAttempts: 3,
      backOff: 100,
      signal: controller.signal 
    }, asyncFunction);
    
    // Abort after operation completes
    setTimeout(() => controller.abort(), 1000);
    
    const result = await wrappedFunction();
    expect(result).toBe('success');
    expect(asyncFunction).toHaveBeenCalledTimes(2);
  });

  test('abort signal does not interfere when not aborted', async () => {
    const controller = new AbortController();
    
    const asyncFunction = jest.fn()
      .mockRejectedValueOnce(new Error('Failed'))
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce('success');
    
    const wrappedFunction = withRetry({ 
      maxAttempts: 3,
      backOff: 100,
      signal: controller.signal 
    }, asyncFunction);
    
    const result = await wrappedFunction();
    expect(result).toBe('success');
    expect(asyncFunction).toHaveBeenCalledTimes(3);
  });

  test('multiple abort signals with different operations', async () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    
    const asyncFunction1 = jest.fn().mockRejectedValue(new Error('Failed'));
    const asyncFunction2 = jest.fn().mockRejectedValue(new Error('Failed'));
    
    const wrappedFunction1 = withRetry({ 
      maxAttempts: 5,
      backOff: 1000,
      signal: controller1.signal 
    }, asyncFunction1);
    
    const wrappedFunction2 = withRetry({ 
      maxAttempts: 5,
      backOff: 1000,
      signal: controller2.signal 
    }, asyncFunction2);
    
    // Abort only the first operation
    setTimeout(() => controller1.abort(), 100);
    
    const promise1 = wrappedFunction1().catch((e: Error) => e);
    const promise2 = wrappedFunction2().catch((e: Error) => e);
    
    const [result1, result2] = await Promise.all([promise1, promise2]);
    
    expect(result1).toBeInstanceOf(AbortError);
    expect(result2).toBeInstanceOf(MaxAttemptsError);
  });

  test('abort signal with decorator usage', async () => {
    const controller = new AbortController();
    
    class TestService {
      callCount = 0;
      
      @Retryable({ 
        maxAttempts: 3, 
        backOff: 1000,
        signal: controller.signal 
      })
      async fetchData(): Promise<string> {
        this.callCount++;
        throw new Error('Failed');
      }
    }
    
    const service = new TestService();
    
    setTimeout(() => controller.abort(), 100);
    
    try {
      await service.fetchData();
      fail('Should have thrown AbortError');
    } catch (e) {
      expect(e).toBeInstanceOf(AbortError);
    }
    expect(service.callCount).toBe(1);
  });
});

describe('Jitter Support Test', () => {
  test('full jitter reduces backoff time variably', async () => {
    const durations: number[] = [];
    
    for (let iteration = 0; iteration < 5; iteration++) {
      const asyncFunction = jest.fn()
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce('success');
      
      const wrappedFunction = withRetry({
        maxAttempts: 2,
        backOff: 1000,
        useJitter: true,
        jitterType: 'full'
      }, asyncFunction);
      
      const startTime = Date.now();
      await wrappedFunction();
      const duration = Date.now() - startTime;
      durations.push(duration);
      
      // With full jitter, duration should be less than 1000ms
      expect(duration).toBeLessThan(1100); // Some margin for execution time
    }
    
    // Check that durations vary (not all the same)
    const uniqueDurations = new Set(durations.map(d => Math.floor(d / 10)));
    expect(uniqueDurations.size).toBeGreaterThan(1);
  });

  test('equal jitter maintains minimum backoff time', async () => {
    const durations: number[] = [];
    
    for (let iteration = 0; iteration < 5; iteration++) {
      const asyncFunction = jest.fn()
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce('success');
      
      const wrappedFunction = withRetry({
        maxAttempts: 2,
        backOff: 1000,
        useJitter: true,
        jitterType: 'equal'
      }, asyncFunction);
      
      const startTime = Date.now();
      await wrappedFunction();
      const duration = Date.now() - startTime;
      durations.push(duration);
      
      // With equal jitter, duration should be between 500ms and 1000ms
      expect(duration).toBeGreaterThanOrEqual(450); // Some margin
      expect(duration).toBeLessThan(1100);
    }
    
    // Check that durations vary
    const uniqueDurations = new Set(durations.map(d => Math.floor(d / 10)));
    expect(uniqueDurations.size).toBeGreaterThan(1);
  });

  test('decorrelated jitter can increase backoff time', async () => {
    const asyncFunction = jest.fn()
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce('success');
    
    const wrappedFunction = withRetry({
      maxAttempts: 2,
      backOff: 100, // Small base for faster test
      useJitter: true,
      jitterType: 'decorrelated'
    }, asyncFunction);
    
    const startTime = Date.now();
    await wrappedFunction();
    const duration = Date.now() - startTime;
    
    // With decorrelated jitter, duration can be up to 3x baseBackOff
    expect(duration).toBeGreaterThanOrEqual(90);
    expect(duration).toBeLessThan(400); // 100ms * 3 + margin
  });

  test('no jitter maintains exact backoff time', async () => {
    const asyncFunction = jest.fn()
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce('success');
    
    const wrappedFunction = withRetry({
      maxAttempts: 2,
      backOff: 500,
      useJitter: false
    }, asyncFunction);
    
    const startTime = Date.now();
    await wrappedFunction();
    const duration = Date.now() - startTime;
    
    // Without jitter, should be close to exactly 500ms
    expect(duration).toBeGreaterThanOrEqual(450);
    expect(duration).toBeLessThan(600);
  });

  test('jitter with exponential backoff', async () => {
    const durations: number[] = [];
    let attemptCount = 0;
    
    const asyncFunction = jest.fn()
      .mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Failed');
        }
        return 'success';
      });
    
    const wrappedFunction = withRetry({
      maxAttempts: 3,
      backOff: 100,
      backOffPolicy: BackOffPolicy.ExponentialBackOffPolicy,
      exponentialOption: { maxInterval: 1000, multiplier: 2 },
      useJitter: true,
      jitterType: 'full'
    }, asyncFunction);
    
    const startTime = Date.now();
    await wrappedFunction();
    const duration = Date.now() - startTime;
    
    // With exponential backoff and full jitter:
    // First retry: 0-100ms, Second retry: 0-200ms
    // Total should be less than 300ms + margin
    expect(duration).toBeLessThan(400);
    expect(asyncFunction).toHaveBeenCalledTimes(3);
  });

  test('jitter works with decorator', async () => {
    class TestService {
      callCount = 0;
      
      @Retryable({
        maxAttempts: 2,
        backOff: 500,
        useJitter: true,
        jitterType: 'equal'
      })
      async fetchData(): Promise<string> {
        this.callCount++;
        if (this.callCount < 2) {
          throw new Error('Failed');
        }
        return 'success';
      }
    }
    
    const service = new TestService();
    
    const startTime = Date.now();
    const result = await service.fetchData();
    const duration = Date.now() - startTime;
    
    expect(result).toBe('success');
    expect(service.callCount).toBe(2);
    // With equal jitter on 500ms, should be 250-500ms
    expect(duration).toBeGreaterThanOrEqual(200);
    expect(duration).toBeLessThan(600);
  });

  test('jitter with fixed backoff policy', async () => {
    let attemptCount = 0;
    
    const asyncFunction = jest.fn()
      .mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Failed');
        }
        return 'success';
      });
    
    const wrappedFunction = withRetry({
      maxAttempts: 3,
      backOff: 200,
      backOffPolicy: BackOffPolicy.FixedBackOffPolicy,
      useJitter: true,
      jitterType: 'full'
    }, asyncFunction);
    
    const startTime = Date.now();
    await wrappedFunction();
    const duration = Date.now() - startTime;
    
    // With fixed backoff and full jitter:
    // Two retries with 0-200ms each = 0-400ms total
    expect(duration).toBeLessThan(500);
    expect(asyncFunction).toHaveBeenCalledTimes(3);
  });

  test('default jitter type is full when not specified', async () => {
    const asyncFunction = jest.fn()
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce('success');
    
    const wrappedFunction = withRetry({
      maxAttempts: 2,
      backOff: 1000,
      useJitter: true
      // jitterType not specified, should default to 'full'
    }, asyncFunction);
    
    const startTime = Date.now();
    await wrappedFunction();
    const duration = Date.now() - startTime;
    
    // Should behave like full jitter
    expect(duration).toBeLessThan(1100);
  });

  test('jitter disabled by default', async () => {
    const durations: number[] = [];
    
    for (let iteration = 0; iteration < 3; iteration++) {
      const asyncFunction = jest.fn()
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce('success');
      
      const wrappedFunction = withRetry({
        maxAttempts: 2,
        backOff: 500
        // useJitter not specified, should be disabled
      }, asyncFunction);
      
      const startTime = Date.now();
      await wrappedFunction();
      const duration = Date.now() - startTime;
      durations.push(duration);
    }
    
    // Without jitter, all durations should be very similar
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    durations.forEach(d => {
      expect(Math.abs(d - avgDuration)).toBeLessThan(50); // Should be consistent
    });
  });
});

