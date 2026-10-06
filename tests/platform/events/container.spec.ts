import { container } from '../../../src/container';
import { DomainEventDispatcherSymbol, TransactionRunnerSymbol } from '../../../src/platform';

describe('container: eventos de domínio', () => {
    it('AC-0004-12, INV-0004-09: dispatcher e runner resolvem sempre à mesma instância', () => {
        expect(container.resolve(DomainEventDispatcherSymbol)).toBe(
            container.resolve(DomainEventDispatcherSymbol),
        );
        expect(container.resolve(TransactionRunnerSymbol)).toBe(
            container.resolve(TransactionRunnerSymbol),
        );
    });
});
