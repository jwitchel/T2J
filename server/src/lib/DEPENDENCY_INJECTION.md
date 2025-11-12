# Dependency Injection Pattern

## Overview

This codebase uses a **hybrid dependency injection pattern** that balances testability with production convenience:

- **Production**: Singleton exports with automatic dependency wiring
- **Testing**: Optional constructor injection for full control

## Pattern Implementation

### Service Constructor Pattern

All services follow this pattern:

```typescript
export class MyService {
  private dependency: DependencyType;

  constructor(dependency?: DependencyType) {
    this.dependency = dependency || defaultDependencySingleton;
  }

  public async someMethod() {
    // Use this.dependency instead of directly importing singleton
    return this.dependency.doSomething();
  }
}

// Singleton export for production use
export const myService = new MyService();
```

### Benefits

1. **Production Simplicity**: `import { myService } from './my-service'` just works
2. **Test Control**: `new MyService(mockDependency)` for unit tests
3. **No DI Container**: Avoids complexity of InversifyJS/tsyringe for now
4. **Gradual Migration**: Can be refactored to full DI container later

## Current Services Using This Pattern

### Core Services

- `EmailStorageService` (4 dependencies)
- `ToneLearningOrchestrator` (7 dependencies)
- `RelationshipService` (1 dependency)
- `RelationshipDetector` (1 dependency)

### Singleton Services

24 singleton exports exist in the codebase:

```typescript
// Services
export const emailStorageService = new EmailStorageService();
export const relationshipService = new RelationshipService();
export const draftGenerator = new DraftGenerator();
export const inboxProcessor = new InboxProcessor();
export const personService = new PersonService();
export const nameRedactor = new NameRedactor();
export const styleAggregationService = new StyleAggregationService();
export const embeddingService = new EmbeddingService();
export const replyExtractor = new ReplyExtractor();
export const emailContentParser = new EmailContentParser();

// Infrastructure
export const imapPool = new ImapConnectionPool();
export const imapMonitor = new ImapMonitor();
export const emailLockManager = new EmailLockManager();
export const emailMover = new EmailMover();
export const sharedConnection = new Redis(...);

// Queue
export const inboxQueue = new Queue('inbox', ...);
export const trainingQueue = new Queue('training', ...);

// Utilities
export const realTimeLogger = new RealTimeLogger({...});
export const testEmailGenerator = new TestEmailGenerator();
```

## Testing Examples

### Unit Test with Mocked Dependencies

```typescript
import { EmailStorageService } from './email-storage-service';
import { EmbeddingService } from './vector/embedding-service';

describe('EmailStorageService', () => {
  it('should save email with embedding', async () => {
    // Mock dependency
    const mockEmbeddingService = {
      embedText: jest.fn().mockResolvedValue({ vector: [0.1, 0.2] })
    } as unknown as EmbeddingService;

    // Inject mock
    const service = new EmailStorageService(
      mockEmbeddingService,
      undefined,  // Use default for other dependencies
      undefined,
      undefined
    );

    // Test with controlled behavior
    await service.saveEmail({...});
    expect(mockEmbeddingService.embedText).toHaveBeenCalledWith(...);
  });
});
```

### Integration Test with Real Dependencies

```typescript
import { emailStorageService } from './email-storage-service';

describe('EmailStorageService Integration', () => {
  it('should save and retrieve email end-to-end', async () => {
    // Use production singleton with real dependencies
    const result = await emailStorageService.saveEmail({...});
    expect(result.success).toBe(true);
  });
});
```

## Migration Path to Full DI Container

If the codebase grows and manual wiring becomes unwieldy:

### Option 1: InversifyJS

```typescript
import { Container, injectable, inject } from 'inversify';

@injectable()
class EmailStorageService {
  constructor(
    @inject('EmbeddingService') private embeddingService: EmbeddingService,
    @inject('EmailProcessor') private emailProcessor: EmailProcessor,
    // ...
  ) {}
}

const container = new Container();
container.bind<EmbeddingService>('EmbeddingService').to(EmbeddingService).inSingletonScope();
container.bind<EmailStorageService>('EmailStorageService').to(EmailStorageService).inSingletonScope();
```

### Option 2: tsyringe

```typescript
import { injectable, inject, container } from 'tsyringe';

@injectable()
class EmailStorageService {
  constructor(
    private embeddingService: EmbeddingService,
    private emailProcessor: EmailProcessor,
    // ...
  ) {}
}

container.registerSingleton(EmbeddingService);
container.registerSingleton(EmailStorageService);
```

## Best Practices

### DO ✅

- Accept dependencies as optional constructor parameters
- Use `|| defaultSingleton` fallback for production
- Export singleton instance for convenience
- Inject dependencies through constructor in tests
- Use `public`/`private` modifiers for API clarity

### DON'T ❌

- Create dependencies with `new` inside methods
- Import singletons directly in class methods (use constructor-injected field)
- Use `any` for dependency types
- Skip optional parameters (makes testing harder)

## Future Considerations

### When to Adopt Full DI Container

Consider InversifyJS/tsyringe when:

1. **Service count > 50**: Manual wiring becomes error-prone
2. **Complex lifecycle**: Need request-scoped or transient services
3. **Multiple configurations**: Dev/staging/prod need different wiring
4. **Team size > 5**: Need enforced patterns and tooling

### When to Keep Current Pattern

Stay with hybrid pattern if:

1. **Service count < 50**: Manual wiring is manageable
2. **Simple lifecycle**: Singletons are sufficient
3. **Single deployment**: No complex environment variations
4. **Small team**: Can maintain consistency through code review

## References

- [Martin Fowler - Inversion of Control](https://martinfowler.com/bliki/InversionOfControl.html)
- [InversifyJS Documentation](https://inversify.io/)
- [tsyringe Documentation](https://github.com/microsoft/tsyringe)
