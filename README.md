![Retry](https://cdn.iconscout.com/icon/free/png-256/retry-1-386755.png)
## A simple retry decorator for typescript with 0 dependency.
This is inspired by the [Spring-Retry project](https://github.com/spring-projects/spring-retry). Written in Typescript, *100%* Test Coverage.

Import and use it. Retry for `Promise` is supported as long as the `runtime` has promise(nodejs/evergreen-browser).

**Features:**
- 🎯 Use as decorator (`@Retryable`) or function wrapper (`withRetry`)
- ⏱️ Fixed and exponential backoff strategies
- 🚫 Cancellable with `AbortSignal` support
- 🎨 Conditional retry with custom logic
- 📦 Zero dependencies
- 💯 100% test coverage

### Install
> npm install typescript-retry-decorator

### Options
| Option Name       | Type                  | Required? | Default                                 | Description                                                                                                       |
|:-----------------:|:------:|:---------:|:---------------------------------------:|:--------------------------------------------------------------------------------------------------------------------------------:|
| maxAttempts       | number                | Yes       | -                                       | The max attempts to try                                                                                           |
| backOff           | number                | No        | 0                                       | number in `ms` to back off.  If not set, then no wait                                                             |
| backOffPolicy     | enum                  | No        | FixedBackOffPolicy                      | can be fixed or exponential                                                                                       |
| exponentialOption | object                | No        | { maxInterval: 2000,    multiplier: 2 } | This is for the `ExponentialBackOffPolicy` <br/> The max interval each wait and the multiplier for the `backOff`. |
| doRetry           | (e: any) => boolean   | No        | -                                       | Function with error parameter to decide if repetition is necessary.                                               |
| value             | Error/Exception class | No        | [ ]                                     | An array of Exception types that are retryable.                                                                   |
| reraise           | boolean               | No        | false                                   | If `true`, rethrows the original error instead of `MaxAttemptsError` when max attempts is reached.                 |
| signal            | AbortSignal           | No        | -                                       | An `AbortSignal` to cancel the retry operation. Throws `AbortError` when aborted.                                 |

## Usage

### 1. As a Decorator

Use `@Retryable` decorator on class methods:

```typescript
import { Retryable, BackOffPolicy } from 'typescript-retry-decorator';

class ApiService {
  @Retryable({ maxAttempts: 3 })
  async fetchData(url: string) {
    // This method will be retried up to 3 times on failure
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch');
    return response.json();
  }

  @Retryable({ 
    maxAttempts: 3, 
    backOff: 1000,
    backOffPolicy: BackOffPolicy.ExponentialBackOffPolicy
  })
  async uploadFile(file: File) {
    // Retries with exponential backoff: 1s, 2s, 4s
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/upload', { method: 'POST', body: formData });
    if (!response.ok) throw new Error('Upload failed');
    return response.json();
  }
}
```

### 2. As a Function Wrapper

Use `withRetry` to wrap any function:

```typescript
import { withRetry, BackOffPolicy } from 'typescript-retry-decorator';

// Wrap an existing function
async function fetchUser(userId: string) {
  const response = await fetch(`/api/users/${userId}`);
  if (!response.ok) throw new Error('Failed to fetch user');
  return response.json();
}

const fetchUserWithRetry = withRetry(
  { maxAttempts: 3, backOff: 1000 },
  fetchUser
);

// Use it
const user = await fetchUserWithRetry('123');

// Or wrap inline
const processWithRetry = withRetry(
  { maxAttempts: 5, backOff: 2000 },
  async (data: string) => {
    // Your async operation here
    return await someAsyncOperation(data);
  }
);
```

## Examples

### Basic Retry
```typescript
import { Retryable, withRetry } from 'typescript-retry-decorator';

// Decorator style
class Service {
  @Retryable({ maxAttempts: 3 })
  async fetchData() {
    throw new Error('I failed!');
  }
}

// Function wrapper style
const fetchData = withRetry(
  { maxAttempts: 3 },
  async () => {
    throw new Error('I failed!');
  }
);
```

### Retry with Backoff
```typescript
// Fixed backoff - wait 1 second between retries
@Retryable({
  maxAttempts: 3,
  backOffPolicy: BackOffPolicy.FixedBackOffPolicy,
  backOff: 1000
})
async fixedBackOffRetry() {
  throw new Error('I failed!');
}

// Exponential backoff - wait 1s, 3s, 9s
@Retryable({
  maxAttempts: 3,
  backOffPolicy: BackOffPolicy.ExponentialBackOffPolicy,
  backOff: 1000,
  exponentialOption: { maxInterval: 10000, multiplier: 3 }
})
async exponentialBackOffRetry() {
  throw new Error('I failed!');
}
```

### Retry Specific Errors
```typescript
// Only retry on specific error types
@Retryable({ 
  maxAttempts: 3, 
  value: [SyntaxError, ReferenceError]
})
async retrySpecificErrors() {
  throw new SyntaxError('This will retry');
  // throw new TypeError('This will NOT retry');
}
```

### Conditional Retry
```typescript
// Retry only when custom condition is met
@Retryable({ 
  maxAttempts: 3,
  backOff: 1000,
  doRetry: (e: Error) => {
    // Only retry on 429 (Too Many Requests) or 503 (Service Unavailable)
    return e.message.includes('429') || e.message.includes('503');
  }
})
async conditionalRetry() {
  throw new Error('Error: 429 Too Many Requests');
}
```

### Reraise Original Error
```typescript
// By default, MaxAttemptsError is thrown with the original error wrapped
// Use reraise: true to throw the original error instead
@Retryable({ 
  maxAttempts: 3,
  reraise: true  // Throw original error, not MaxAttemptsError
})
async reraiseExample() {
  throw new Error('Original error');
}

try {
  await service.reraiseExample();
} catch (error) {
  // error is the original Error, not MaxAttemptsError
  console.log(error.message); // "Original error"
}
```

### Cancellable Retry with AbortSignal
```typescript
import { withRetry, AbortError } from 'typescript-retry-decorator';

// Create an abort controller
const controller = new AbortController();

// Function wrapper with signal
const fetchWithRetry = withRetry(
  { 
    maxAttempts: 10, 
    backOff: 2000,
    signal: controller.signal  // Pass the abort signal
  },
  async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed');
    return response.json();
  }
);

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  const data = await fetchWithRetry('https://api.example.com/data');
} catch (error) {
  if (error instanceof AbortError) {
    console.log('Retry operation was cancelled');
  }
}

// Also works with decorator
const controller2 = new AbortController();

class Service {
  @Retryable({ 
    maxAttempts: 5, 
    backOff: 1000,
    signal: controller2.signal 
  })
  async fetchData() {
    // Will be cancelled when controller2.abort() is called
  }
}
```

### Real-world Example
```typescript
import { withRetry, BackOffPolicy, MaxAttemptsError, AbortError } from 'typescript-retry-decorator';

class ApiClient {
  private baseUrl = 'https://api.example.com';

  // Decorator on class method
  @Retryable({
    maxAttempts: 3,
    backOff: 1000,
    backOffPolicy: BackOffPolicy.ExponentialBackOffPolicy,
    exponentialOption: { maxInterval: 5000, multiplier: 2 },
    doRetry: (e: Error) => {
      // Retry on network errors or 5xx server errors
      return e.message.includes('network') || e.message.includes('5');
    }
  })
  async get(endpoint: string) {
    const response = await fetch(`${this.baseUrl}${endpoint}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  // Function wrapper with cancellation
  async getWithCancellation(endpoint: string, timeoutMs: number) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const fetchWithRetry = withRetry(
      {
        maxAttempts: 5,
        backOff: 1000,
        backOffPolicy: BackOffPolicy.ExponentialBackOffPolicy,
        signal: controller.signal,
        reraise: false
      },
      async () => {
        const response = await fetch(`${this.baseUrl}${endpoint}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }
    );

    try {
      const data = await fetchWithRetry();
      clearTimeout(timeoutId);
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof AbortError) {
        console.log('Request cancelled due to timeout');
      } else if (error instanceof MaxAttemptsError) {
        console.log(`Failed after ${error.retryCount} attempts`);
      }
      throw error;
    }
  }
}
```

## API Reference

### Exports

```typescript
// Main functions
export function Retryable(options: RetryOptions): DecoratorFunction;
export function withRetry<T extends (...args: any[]) => any>(
  options: RetryOptions,
  fn: T
): T;

// Error classes
export class MaxAttemptsError extends Error {
  code: string;
  retryCount: number;
  originalError: Error;
}

export class AbortError extends Error {
  code: string;
  name: string;
}

// Enums
export enum BackOffPolicy {
  FixedBackOffPolicy = 'FixedBackOffPolicy',
  ExponentialBackOffPolicy = 'ExponentialBackOffPolicy'
}

// Interfaces
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
```

## Common Use Cases

### API Rate Limiting
```typescript
const apiCall = withRetry(
  {
    maxAttempts: 5,
    backOff: 1000,
    backOffPolicy: BackOffPolicy.ExponentialBackOffPolicy,
    doRetry: (e: Error) => e.message.includes('429')
  },
  async () => await fetch('/api/data')
);
```

### Network Resilience
```typescript
@Retryable({
  maxAttempts: 3,
  backOff: 2000,
  value: [TypeError, NetworkError], // Retry only on network errors
  exponentialOption: { maxInterval: 10000, multiplier: 2 }
})
async fetchFromUnstableService() {
  // Your code here
}
```

### User-Cancellable Operations
```typescript
const controller = new AbortController();

// Show cancel button to user
document.getElementById('cancelBtn').onclick = () => controller.abort();

const operation = withRetry(
  { maxAttempts: 10, backOff: 1000, signal: controller.signal },
  async () => await longRunningOperation()
);
```

## License

MIT
