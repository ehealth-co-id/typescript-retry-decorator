import { sleep } from './utils';

/**
 * Core retry logic that can be used by both decorator and function wrapper
 */
function createRetryHandler(options: RetryOptions) {
  // set default value for ExponentialBackOffPolicy
  if (options.backOffPolicy === BackOffPolicy.ExponentialBackOffPolicy) {
    setExponentialBackOffPolicyDefault(options);
  }

  async function retryAsync(fn: (...args: any[]) => any, context: any, args: any[]): Promise<any> {
    let backOff = options.backOff;
    for (let i = 0; i < (options.maxAttempts + 1); i++) {
      // Check if signal is already aborted before attempting
      if (options.signal?.aborted) {
        throw new AbortError('Retry operation aborted');
      }

      try {
        return await fn.apply(context, args);
      } catch (e) {
        if (i == options.maxAttempts) {
          if (options.reraise) {
            throw e;
          }
          throw new MaxAttemptsError(e, i);
        }
        if (!canRetry(e)) {
          throw e;
        }
        
        // Check if signal is aborted before sleeping
        if (options.signal?.aborted) {
          throw new AbortError('Retry operation aborted');
        }
        
        // Sleep with abort signal support
        if (backOff) {
          await sleepWithAbort(backOff, options.signal);
        }
        
        if (options.backOffPolicy === BackOffPolicy.ExponentialBackOffPolicy) {
          backOff = Math.min(backOff * Math.pow(options.exponentialOption.multiplier, i), options.exponentialOption.maxInterval);
        }
      }
    }
  }

  async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new AbortError('Retry operation aborted');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      
      const onAbort = () => {
        clearTimeout(timeout);
        reject(new AbortError('Retry operation aborted'));
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      // Clean up the event listener when sleep completes normally
      setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
      }, ms);
    });
  }

  function canRetry(e: Error): boolean {
    if (options.doRetry && !options.doRetry(e)) {
      return false;
    }
    if (options.value?.length && !options.value.some(errorType => e instanceof errorType)) {
      return false;
    }
    return true;
  }

  function setExponentialBackOffPolicyDefault(opts: RetryOptions): void {
    !opts.backOff && (opts.backOff = 1000);
    opts.exponentialOption = {
      ...{ maxInterval: 2000, multiplier: 2 },
      ...opts.exponentialOption,
    };
  }

  return retryAsync;
}

/**
 * Wraps a function with retry logic. Can be used as a standalone function wrapper.
 * 
 * @param options the 'RetryOptions'
 * @param fn the function to wrap with retry logic
 * @returns a wrapped function with retry capabilities
 * 
 * @example
 * ```typescript
 * // Basic usage
 * const fetchWithRetry = withRetry({ maxAttempts: 3, backOff: 1000 }, fetchData);
 * const result = await fetchWithRetry(url);
 * 
 * // With AbortSignal for cancellation
 * const controller = new AbortController();
 * const fetchWithRetry = withRetry({ 
 *   maxAttempts: 5, 
 *   backOff: 2000,
 *   signal: controller.signal 
 * }, fetchData);
 * 
 * // Cancel the retry operation
 * setTimeout(() => controller.abort(), 3000);
 * 
 * try {
 *   const result = await fetchWithRetry(url);
 * } catch (error) {
 *   if (error instanceof AbortError) {
 *     console.log('Retry operation was cancelled');
 *   }
 * }
 * ```
 */
export function withRetry<T extends (...args: any[]) => any>(
  options: RetryOptions,
  fn: T
): T {
  const retryHandler = createRetryHandler(options);
  
  return (async function(this: any, ...args: any[]) {
    return await retryHandler(fn, this, args);
  }) as T;
}

/**
 * retry decorator which is nothing but a high order function wrapper
 *
 * @param options the 'RetryOptions'
 * 
 * @example
 * ```typescript
 * class MyService {
 *   @Retryable({ maxAttempts: 3, backOff: 1000 })
 *   async fetchData(url: string) {
 *     // ... implementation
 *   }
 * }
 * ```
 */
export function Retryable(options: RetryOptions): DecoratorFunction {
  const retryHandler = createRetryHandler(options);
  
  /**
   * target: The prototype of the class (Object)
   * propertyKey: The name of the method (string | symbol).
   * descriptor: A TypedPropertyDescriptor — see the type, leveraging the Object.defineProperty under the hood.
   *
   * NOTE: It's very important here we do not use arrow function otherwise 'this' will be messed up due
   * to the nature how arrow function defines this inside.
   *
   */
  return function(target: Record<string, any>, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) {
    const originalFn = descriptor.value;
    
    descriptor.value = async function(...args: any[]) {
      return await retryHandler(originalFn, this, args);
    };
    
    return descriptor;
  };
}

export class MaxAttemptsError extends Error {
  code = '429';
  public retryCount: number;
  public originalError: Error; 
  constructor(originalError: Error, retryCount: number) {
    super(`Max retry reached: ${retryCount}, original error: ${originalError.message}`);
    this.originalError = originalError;
    this.retryCount = retryCount;
    Object.setPrototypeOf(this, MaxAttemptsError.prototype);
  }
}

export class AbortError extends Error {
  code = 'ABORT_ERR';
  constructor(message: string = 'The operation was aborted') {
    super(message);
    this.name = 'AbortError';
    Object.setPrototypeOf(this, AbortError.prototype);
  }
}

export interface RetryOptions {
  maxAttempts: number;
  backOffPolicy?: BackOffPolicy;
  backOff?: number;
  doRetry?: (e: any) => boolean;
  value?: ErrorConstructor[];
  exponentialOption?: { maxInterval: number; multiplier: number };
  reraise?: boolean;
  signal?: AbortSignal;
}

export enum BackOffPolicy {
  FixedBackOffPolicy = 'FixedBackOffPolicy',
  ExponentialBackOffPolicy = 'ExponentialBackOffPolicy'
}

export type DecoratorFunction = (target: Record<string, any>, propertyKey: string, descriptor: TypedPropertyDescriptor<any>) => TypedPropertyDescriptor<any>;

