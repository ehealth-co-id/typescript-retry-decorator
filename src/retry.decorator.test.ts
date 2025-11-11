import { BackOffPolicy, MaxAttemptsError, Retryable, withRetry } from './retry.decorator';

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

